"""Teacher-forcing batches matching MLX Audio's Qwen3-TTS Base generation.

Qwen's original training implementation and MLX Audio are Apache-2.0:
https://github.com/QwenLM/Qwen3-TTS/tree/main/finetuning
https://github.com/Blaizzy/mlx-audio/tree/main/mlx_audio/tts/models/qwen3_tts

Unlike mlx-tune 0.6.0's stock Qwen collator, this delegates prompt preparation
to the *installed inference implementation*. In mlx-audio 0.6.1 that means
language + speaker conditioning, full-text prefill, then audio conditioned on
tts_pad. Intended for talker attention LoRA with embeddings, speaker encoder,
speech codec and code predictor frozen. It trains first-codebook predictions;
the other codebooks are teacher-forced conditioning, not training targets.
"""

from __future__ import annotations

from typing import Any

import mlx.core as mx
import numpy as np
from mlx_tune.tts import TTSDataCollator


class _GenerationView:
    """Read-only view supplying an already computed speaker embedding."""

    def __init__(self, model: Any, speaker_embedding: mx.array):
        self._model = model
        self._speaker_embedding = speaker_embedding

    def __getattr__(self, name: str) -> Any:
        return getattr(self._model, name)

    def extract_speaker_embedding(self, _ref_audio: mx.array) -> mx.array:
        return self._speaker_embedding


class QwenBaseCollator(TTSDataCollator):
    """Produce ``inputs_embeds`` and ``labels`` for ``TTSSFTTrainer``.

    ``model`` is the wrapper returned by ``FastTTSModel.from_pretrained``.
    Compute ``speaker_embedding = model.full_model.extract_speaker_embedding``
    on a mono 24 kHz reference waveform once, before constructing this class.

    Preferred samples: ``{"text": str, "audio_codes": integer_array[T, 16]}``.
    Set ``audio_codes_layout="codebook_major"`` in a sample (or constructor)
    for [16, T] codes from ``codec_adapter.encode_all_codebooks``. If codes are
    absent, the ordinary mlx-tune ``audio`` dict with array/sampling_rate is
    encoded on demand; pre-encode to avoid doing this for every training step.

    Labels are shifted once by TTSSFTTrainer. Every prompt position is -100;
    the last prompt position predicts the first audio code, the last audio
    frame predicts EOS. Oversized samples raise instead of silently losing EOS.
    """

    def __init__(
        self,
        model: Any,
        tokenizer: Any = None,
        *,
        speaker_embedding: Any,
        language: str = "English",
        max_seq_length: int = 512,
        audio_codes_layout: str = "time_major",
        text_column: str = "text",
        audio_column: str = "audio",
    ):
        super().__init__(
            model=model,
            tokenizer=tokenizer or model.tokenizer,
            max_seq_length=max_seq_length,
            text_column=text_column,
            audio_column=audio_column,
        )
        self.full_model = model.full_model
        if self.full_model is None:
            raise ValueError("QwenBaseCollator requires the complete Qwen MLX model")
        if self.full_model.speaker_encoder is None:
            raise ValueError("Use a Qwen3-TTS Base model containing its speaker encoder")
        self.language = language
        languages = self.full_model.config.talker_config.codec_language_id or {}
        if language.lower() != "auto" and language.lower() not in languages:
            raise ValueError(f"Unsupported language {language!r}; choices: {list(languages)}")
        if audio_codes_layout not in ("time_major", "codebook_major"):
            raise ValueError("audio_codes_layout must be time_major or codebook_major")
        self.audio_codes_layout = audio_codes_layout
        embedding = mx.array(speaker_embedding)
        if embedding.ndim not in (1, 2, 3) or embedding.size == 0:
            raise ValueError("speaker_embedding must contain one nonempty speaker vector")
        if embedding.ndim > 1 and any(n != 1 for n in embedding.shape[:-1]):
            raise ValueError("speaker_embedding must contain exactly one speaker vector")
        self.speaker_embedding = mx.stop_gradient(embedding.reshape(1, -1))
        mx.eval(self.speaker_embedding)

    def prepare_prefix(self, text: str) -> tuple[mx.array, mx.array, mx.array]:
        """Use the exact installed inference function without mutating the model."""
        view = _GenerationView(self.full_model, self.speaker_embedding)
        prepare = self.full_model._prepare_generation_inputs.__func__
        # Only a presence marker: the view returns the precomputed embedding;
        # no speech encoding is performed and no model method is replaced.
        prefix, trailing, pad = prepare(
            view, text, language=self.language, ref_audio=mx.zeros((1,))
        )
        if prefix.shape[-1] != self.speaker_embedding.shape[-1]:
            raise ValueError("Speaker embedding width differs from talker hidden size")
        return tuple(mx.stop_gradient(x) for x in (prefix, trailing, pad))

    def _codes(self, sample: dict) -> mx.array:
        groups = self.full_model.config.talker_config.num_code_groups
        if "audio_codes" in sample:
            data = np.asarray(sample["audio_codes"])
            layout = sample.get("audio_codes_layout", self.audio_codes_layout)
            if layout == "codebook_major":
                data = data.T
            elif layout != "time_major":
                raise ValueError("audio_codes_layout must be time_major or codebook_major")
        else:
            audio = sample.get(self.audio_column)
            if not isinstance(audio, dict) or "array" not in audio:
                raise ValueError("Supply audio_codes[T,16] or audio with array/sampling_rate")
            if audio.get("sampling_rate") != 24000:
                raise ValueError("Training waveform must already be resampled to 24000 Hz")
            data = np.asarray(
                self.model.codec_adapter.encode_all_codebooks(audio["array"], 24000)
            ).T
        if data.ndim != 2 or data.shape[1] != groups or data.shape[0] == 0:
            raise ValueError(f"Expected nonempty audio codes [T,{groups}], got {data.shape}")
        if not np.issubdtype(data.dtype, np.integer):
            raise ValueError("Audio codes must be integers, not waveform samples")
        if data.min() < 0 or data.max() >= 2048:
            raise ValueError("Speech tokenizer code IDs must be in [0,2048)")
        return mx.array(data, dtype=mx.int32)

    def _process_sample_qwen3(self, sample: dict) -> tuple[mx.array, list[int]]:
        text = sample.get(self.text_column)
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Each training sample needs a nonempty text transcript")
        prefix, trailing, pad = self.prepare_prefix(text)
        codes = self._codes(sample)  # [T, code_groups]
        frames = codes.shape[0]
        talker = self.full_model.talker
        audio_embeds = talker.get_input_embeddings()(codes[None, :, 0])
        for group in range(1, codes.shape[1]):
            audio_embeds = audio_embeds + talker.code_predictor.codec_embedding[
                group - 1
            ](codes[None, :, group])

        # Same text conditioning as inference's autoregressive loop. In 0.6.1
        # trailing is one tts_pad vector because all text was already prefetched.
        count = min(frames, trailing.shape[1])
        text_embeds = trailing[:, :count, :]
        if count < frames:
            text_embeds = mx.concatenate(
                [text_embeds, mx.broadcast_to(pad, (1, frames - count, pad.shape[-1]))],
                axis=1,
            )
        eos = self.full_model.config.talker_config.codec_eos_token_id
        # The final EOS input is ignored after the trainer's next-token shift;
        # it exists to align the EOS target with the preceding audio frame.
        eos_embed = talker.get_input_embeddings()(mx.array([[eos]])) + pad
        inputs = mx.concatenate([prefix, audio_embeds + text_embeds, eos_embed], axis=1)
        labels = [-100] * prefix.shape[1] + np.asarray(codes[:, 0]).tolist() + [eos]
        if inputs.shape[1] > self.max_seq_length:
            raise ValueError(
                f"Sample needs {inputs.shape[1]} positions, exceeds max_seq_length="
                f"{self.max_seq_length}; use a shorter audio/text pair"
            )
        mx.eval(inputs)
        return mx.stop_gradient(inputs[0]), labels

    def __call__(self, samples: list[dict] | dict) -> dict[str, mx.array]:
        if isinstance(samples, dict):
            samples = [samples]
        if not samples:
            raise ValueError("Cannot collate an empty batch")
        examples = [self._process_sample_qwen3(sample) for sample in samples]
        length = max(x.shape[0] for x, _ in examples)
        embeds, labels = [], []
        for example, target in examples:
            missing = length - example.shape[0]
            if missing:
                example = mx.concatenate(
                    [example, mx.zeros((missing, example.shape[-1]), dtype=example.dtype)]
                )
            embeds.append(example)
            labels.append(target + [-100] * missing)
        return {"inputs_embeds": mx.stack(embeds), "labels": mx.array(labels, mx.int32)}


def _self_test() -> None:
    """Model-free check against the installed canonical inference method."""
    from types import SimpleNamespace
    from mlx_audio.tts.models.qwen3_tts.qwen3_tts import Model

    width = 4

    def embedding(ids):
        return mx.broadcast_to(ids[..., None].astype(mx.float32), (*ids.shape, width))

    class FakeModel:
        _prepare_generation_inputs = Model._prepare_generation_inputs

        def extract_speaker_embedding(self, audio):
            return mx.array([[7.0] * width])

    codec = SimpleNamespace(
        codec_language_id={"english": 10}, spk_id={}, spk_is_dialect={},
        codec_nothink_id=11, codec_think_id=12, codec_think_bos_id=13,
        codec_think_eos_id=14, codec_pad_id=15, codec_bos_id=16,
        codec_eos_token_id=2049, num_code_groups=16,
    )
    full = FakeModel()
    full.config = SimpleNamespace(
        talker_config=codec, tts_bos_token_id=17, tts_eos_token_id=18,
        tts_pad_token_id=19,
    )
    full.speaker_encoder = object()
    full.tokenizer = SimpleNamespace(encode=lambda text: list(range(1, 13)))
    full.talker = SimpleNamespace(
        text_projection=lambda x: x,
        get_text_embeddings=lambda: embedding,
        get_input_embeddings=lambda: embedding,
        code_predictor=SimpleNamespace(codec_embedding=[embedding] * 15),
    )
    wrapper = SimpleNamespace(full_model=full, tokenizer=full.tokenizer)
    collator = QwenBaseCollator(wrapper, speaker_embedding=[7.0] * width)
    exact, _, pad = full._prepare_generation_inputs(
        "Hello.", language="English", ref_audio=mx.zeros((240,))
    )
    prefix, _, _ = collator.prepare_prefix("Hello.")
    assert mx.array_equal(exact, prefix).item(), "Conditioned prefix drifted from inference"
    codes = np.arange(48, dtype=np.int32).reshape(3, 16)
    batch = collator({"text": "Hello.", "audio_codes": codes})
    n = prefix.shape[1]
    assert batch["inputs_embeds"].shape == (1, n + 4, width)
    assert batch["labels"].tolist() == [[-100] * n + [0, 16, 32, 2049]]
    # Last prefix predicts code_0; preceding frames predict code_0[t+1]/EOS.
    assert batch["labels"][0, 1:][n - 1:].tolist() == [0, 16, 32, 2049]
    expected_audio = mx.array(codes.sum(axis=1))[:, None] + pad[0]
    assert mx.array_equal(batch["inputs_embeds"][0, n:n + 3], expected_audio).item()
    other = QwenBaseCollator(wrapper, speaker_embedding=[9.0] * width)
    assert not mx.array_equal(other.prepare_prefix("Hello.")[0], prefix).item()
    auto = QwenBaseCollator(wrapper, speaker_embedding=[7.0] * width, language="auto")
    assert auto.prepare_prefix("Hello.")[0].shape[1] == n - 1
    transposed = collator({
        "text": "Hello.", "audio_codes": codes.T, "audio_codes_layout": "codebook_major"
    })
    assert mx.array_equal(transposed["inputs_embeds"], batch["inputs_embeds"]).item()
    print("QwenBaseCollator self-test passed: canonical prefix, speaker/language, 16 "
          "codebooks, layouts, shapes, next-token masking and EOS")


if __name__ == "__main__":
    _self_test()
