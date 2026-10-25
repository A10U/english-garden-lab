# English Garden Lab — Speech practice

เปิด [หน้าฝึกฟังและพูด](listen.html) เพื่อฝึกทีละประโยคหรือทีละคำ มีคำแปลไทย ตัวอย่างเสียงจริง ปุ่มฟังช้า และ A/B ของเสียงก่อน/หลังการทดลอง LoRA เสียงตัวอย่างที่รวมไว้เป็นเสียง AI สังเคราะห์ ไม่ใช่เสียงไมโครโฟนของผู้ใช้

## ใช้เดโมที่เผยแพร่

เมื่อเปิดผ่าน HTTPS คุณบันทึก ฟัง และวิเคราะห์เสียงตัวเองได้ในเบราว์เซอร์ กดดูผลครั้งแรกเพื่อดาวน์โหลดโมเดลประมาณ **318 MB** จาก Hugging Face และชุดประมวลผลประมาณ **12 MB** จากเว็บนี้ เสียงของคุณประมวลผลในเบราว์เซอร์ ไม่ส่งไปเซิร์ฟเวอร์และไม่เชื่อมต่อ localhost ของผู้เข้าชม ผลของเสียง AI เป็น **ผลวิเคราะห์เสียงตัวอย่างที่เตรียมไว้** ซึ่งผูกกับไฟล์นั้นโดยตรงและแยกจากเสียงที่คุณบันทึก

หากดาวน์โหลด repository ให้รันจากโฟลเดอร์หลัก:

```sh
python3 speech-training/build_demo.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

เปิด <http://127.0.0.1:8765/speech-training/listen.html> เพื่อฝึกจากไฟล์ใน `dist/` ไม่ต้องติดตั้ง Python dependencies เพื่อใช้โมเดลในเบราว์เซอร์ และไม่ดาวน์โหลดโมเดลเพื่อ build เรียน หรือฟังตัวอย่าง

เบราว์เซอร์ใช้ [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) **1.23.2** แบบ WebAssembly ใน worker และ [wav2vec2-lv-60-espeak-cv-ft-ONNX](https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/tree/c69750f5043e5e1f8a71ab95dd3b98338c280c92) revision `c69750f5043e5e1f8a71ab95dd3b98338c280c92` ไฟล์ `onnx/model_quantized.onnx` ขนาด 317,712,852 bytes; SHA256 `3d1479b5c70836645a4310902479f7f7e8bbc8c16c58745d918804f4f6f9d120` รับเสียง mono 16 kHz และอ่าน acoustic phone labels จริง ไม่ได้แปลงข้อความที่ผู้ใช้คาดว่าจะพูดมาแทนเสียง

ใช้หน่วยความจำมากกว่า 318 MB และความเร็วขึ้นกับอุปกรณ์ ลองฝึกคำหรือประโยคสั้นก่อน อุปกรณ์ที่หน่วยความจำไม่พออาจโหลดโมเดลไม่ได้ ผลจับคู่และเวลาเป็นค่าประมาณจาก acoustic model ไม่ใช่คะแนนความสามารถภาษา การรับรองสำเนียง หรือ forced alignment ที่ผู้เชี่ยวชาญตรวจ หากไม่ใช้โมเดลในเบราว์เซอร์ยังฟังและอัดเสียงได้ หรือใช้บริการในเครื่องด้านล่าง

## Local service

บริการนี้ใช้ **eSpeak NG/Phonemizer** สร้าง IPA จากข้อความ และใช้ acoustic model แยกหน่วยเสียงจากไฟล์จริง ทำงานด้วย CPU และรับคำขอเฉพาะหน้าเว็บในเครื่อง ขั้นตอนต่อไปนี้ใช้สภาพแวดล้อม macOS Apple Silicon เดียวกับงานทดลอง; `requirements-lock.txt` รวม MLX/Metal สำหรับฝึก TTS จึงไม่ใช่ lock สำหรับทุกระบบปฏิบัติการ

ต้องมี Python 3.11 ผ่าน `uv`, Homebrew และอินเทอร์เน็ตสำหรับติดตั้ง/ดาวน์โหลดครั้งแรก รันจากโฟลเดอร์หลัก:

```sh
brew install ffmpeg espeak-ng
uv venv --python 3.11 speech-training/.venv
uv pip install --python speech-training/.venv/bin/python -r speech-training/requirements-lock.txt
speech-training/.venv/bin/python speech-training/download_phonetic_model.py
bash speech-training/start-phonetics.command
```

เปิด <http://127.0.0.1:8766/speech-training/listen.html> หรือ <http://127.0.0.1:8766/app/index.html> เพื่อใช้บริการ Python ในเครื่อง และหยุดบริการด้วย **Ctrl+C** เดโมบนเว็บไซต์ใช้โมเดลในเบราว์เซอร์แทน ไม่ติดต่อบริการ localhost นี้

กดบันทึก → หยุด → รอเตรียม WAV → **ฟังเสียงของฉัน** หรือ **ดูผลเสียงของฉัน** รับไฟล์ไม่เกิน 15 วินาที / 10 MB หากเบราว์เซอร์ถอดเสียงบันทึกไม่ได้ `/api/phonetics/normalize` จะเตรียม WAV ในเครื่องโดยไม่เรียกโมเดลวิเคราะห์ ไฟล์ชั่วคราวถูกลบหลังประมวลผล และไม่มีการเล่นเสียงอัตโนมัติ

การจับคู่ใช้หน่วยเสียงที่ตรวจพบจริง แสดงเปอร์เซ็นต์ตามสูตร `เสียงตรง / (เสียงอ้างอิง + เสียงเพิ่ม) × 100` และช่วงเวลาเล่นซ้ำโดยประมาณ ไม่ใช่คะแนนสอบภาษา ความมั่นใจของโมเดล หรือการรับรองสำเนียงเจ้าของภาษา การฝึกคำใช้คำอ่านตามบริบทประโยคเดิม และแยกผลคำออกจากผลประโยค

## ฝึก TTS ในเครื่อง

โค้ดทดลองใช้ **Qwen3-TTS 0.6B Base แบบ MLX 8-bit + LoRA** บน Apple Silicon และข้อมูล Hi-Fi TTS ผู้พูด 92 ฝึกเฉพาะ attention adapters ส่วนโมเดลต้นทางและส่วนประกอบเสียงอื่นถูก freeze การลด training loss ยังไม่ยืนยันว่าเสียงเป็นธรรมชาติขึ้น ให้ฟังเทียบด้วยตนเอง

repository ไม่รวม model weights, virtual environment, corpus ต้นทาง หรือผลใน `runs/` สคริปต์จะสร้างไฟล์เหล่านี้ในเครื่อง ดาวน์โหลดโมเดลและเตรียมข้อมูลหลังติดตั้ง `.venv` แล้ว:

```sh
speech-training/.venv/bin/python speech-training/download_model.py
speech-training/.venv/bin/python speech-training/prepare_dataset.py
speech-training/.venv/bin/python speech-training/train.py \
  --steps 300 --accumulate 4 --eval-every 25 \
  --output speech-training/runs/my-run
```

การเตรียมข้อมูลดึงเฉพาะ shard ที่ pin revision/SHA256 แล้ว คัดเสียง 512 train / 32 validation / 32 test แยกบทต้นฉบับ และกันข้อความใน [evaluation-prompts.json](resources/evaluation-prompts.json) ออกจากการฝึก เก็บ reference audio/text และ provenance ใน `data/dataset-info.json` ที่สร้างใหม่ ใช้ output directory ใหม่ในแต่ละรอบ; adapters ที่บันทึกไม่ใช่ optimizer-state checkpoint สำหรับ resume ทุกขั้น

สร้างตัวอย่างจาก adapter ที่สคริปต์เลือก โดยอ่าน reference จากข้อมูลที่เพิ่งเตรียม:

```sh
speech-training/.venv/bin/python - <<'PY'
import json
import subprocess
import sys
from pathlib import Path

data = Path('speech-training/data')
run = Path('speech-training/runs/my-run')
reference = json.loads((data / 'dataset-info.json').read_text())['reference']
result = json.loads((run / 'result.json').read_text())
subprocess.run([
    sys.executable, 'speech-training/synthesize.py',
    '--model', 'speech-training/models/qwen3-tts-0.6b-base-8bit',
    '--adapter', str(run / result['suggested_adapter']),
    '--ref-audio', str(data / reference['audio']),
    '--ref-text', reference['text'],
    '--prompts', 'speech-training/resources/evaluation-prompts.json',
    '--limit', '3', '--output-dir', str(run / 'samples'),
], check=True)
PY
```

`--conditioning speaker` เป็นค่าเริ่มต้นให้ตรงกับการฝึก การสร้างเสียงไม่เล่นลำโพงเองและอ่านโมเดลในเครื่องเท่านั้น `--conditioning icl` เป็นคนละวิธีป้อน reference จึงควรใช้เงื่อนไขเดียวกันตลอดการเทียบ A/B ดูตัวเลือกอื่นด้วย `synthesize.py --help`

## ข้อมูลและสคริปต์

- [resources/evaluation-prompts.json](resources/evaluation-prompts.json): ข้อความทดสอบที่ไม่ใช้ฝึก
- [resources/phonetics.json](resources/phonetics.json): IPA จากข้อความที่เตรียมไว้; สร้างซ้ำด้วย `build_phonetic_data.py` หลังติดตั้ง eSpeak NG
- [resources/reference-audio.json](resources/reference-audio.json): ช่วงคำสำหรับเล่นจากเสียงตัวอย่าง; `build_reference_audio.py` ใช้ไฟล์ TTS ที่สร้างเองและบริการในเครื่องเพื่อเตรียมข้อมูลใหม่
- [model-source.json](model-source.json), [phonetic-model-source.json](phonetic-model-source.json): แหล่งและ revision ของโมเดลที่สคริปต์ดาวน์โหลด
- [build_listen.py](build_listen.py): สร้างหน้าฟังจาก synthesis metadata และผลฝึกของคุณ; ดู `--help` ก่อนระบุ `--baseline`, `--candidate` และ `--training-result`
- [demo-assets/](demo-assets/): WAV และผลวิเคราะห์ AI ที่คัดไว้สำหรับเว็บสาธารณะ พร้อม SHA256 และ attribution

ตรวจไฟล์เดโมที่รวมมาได้โดยไม่ต้องมีโมเดลหรือผลฝึกต้นฉบับ:

```sh
python3 speech-training/export_demo_assets.py --verify
```

## ทดสอบ

```sh
speech-training/.venv/bin/python -m unittest discover -s speech-training -p 'test_phonetic*.py' -v
cd app
npm ci
npm test
```

ชุดทดสอบอัตโนมัติไม่แทนการลองสิทธิ์ไมค์และฟังผ่านอุปกรณ์จริงของผู้ใช้

## แหล่งข้อมูลและสิทธิ์

ข้อมูลฝึก [Hi-Fi TTS](https://www.openslr.org/109/) โดย Evelina Bakhturina, Vitaly Lavrukhin, Boris Ginsburg และ Yang Zhang (2021) ใช้ **CC BY 4.0** เลือก subset และ resample เพื่อฝึกเสียง ดูรายละเอียดการดัดแปลงและที่มาของเดโมใน [ATTRIBUTION.txt](demo-assets/ATTRIBUTION.txt)

[Qwen3-TTS Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base), [MLX Audio](https://github.com/Blaizzy/mlx-audio), [MLX-Tune](https://github.com/ARahim3/mlx-tune), acoustic checkpoint [wav2vec2-lv-60-espeak-cv-ft](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft) และ [ONNX conversion](https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX) ระบุ Apache 2.0; ONNX Runtime ใช้ MIT License พร้อม notices ใน `app/vendor/onnxruntime/` ส่วน [Phonemizer](https://bootphon.github.io/phonemizer/) และ [eSpeak NG](https://github.com/espeak-ng/espeak-ng) เป็น dependency GPL 3.0 ที่ติดตั้งแยก โมเดล browser ดาวน์โหลดเมื่อกดใช้ ไม่รวม model weights หรือชุดเสียงต้นฉบับไว้ใน repository
