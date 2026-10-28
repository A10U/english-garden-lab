# เทรนบน Hugging Face แล้วนำโมเดลกลับมาใช้ local

เส้นทางนี้เทรนโมเดลเสียงแบบเปิด `wav2vec2-lv-60-espeak-cv-ft` บน CUDA แล้วเก็บน้ำหนักโมเดลและ checkpoint เป็นไฟล์ ไม่ได้เทรน ChatGPT/Gemini และไม่อ่านคีย์ OpenAI ใน `.env.speech-cloud` ผลยังเป็น acoustic phoneme recognition ไม่ใช่คะแนนการออกเสียงที่สอบเทียบกับผู้เชี่ยวชาญ

## รอบทดลองและค่าใช้จ่าย

รอบแรกใช้ LibriSpeech ที่เตรียมไว้แล้วเพียง 256 คลิป train, 32 validation และ 32 test รวม train ประมาณ 0.864 ชั่วโมง แยกผู้พูดข้ามชุด ใช้ได้สูงสุด 50 optimizer steps ตาม recipe เดิม ก่อนขยายเป็น 100 ชั่วโมง ไม่อ้างว่ารอบทดลองนี้เทรนครบ 100 ชั่วโมง

เลือก `a10g-small`, หนึ่ง attempt, timeout ภายนอก 30 นาที ตัวควบคุมตรวจราคาจาก API ปัจจุบันก่อนส่ง Job และหยุดหากเกิน $1.01/ชั่วโมง ราคาที่ตรวจ 28 ตุลาคม 2026 คือประมาณ $1/ชั่วโมง จึงประมาณ $0.50 ค่าเครื่องต่อรอบ 30 นาที ราคานี้ไม่ใช่ราคาเทรนเต็มชุดหรือการรับประกันค่าบริการอื่น บัญชีต้องมีเครดิตคงเหลือ การผูกบัตรอย่างเดียวอาจไม่พอ

ตัว trainer มีเวลาทำงาน 20 นาที จากนั้นส่ง SIGTERM และให้เวลาเก็บ checkpoint อีก 60 วินาที ก่อนบังคับหยุดหากจำเป็น เวลาติดตั้ง ดาวน์โหลด และอัปโหลดอยู่ภายใน timeout ของ Job ด้วย หากหมดเวลาภายนอกระหว่างอัปโหลดอาจยังไม่มีไฟล์ครบ ต้องตรวจ artifact จริงทุกครั้ง

## คีย์และพื้นที่เก็บไฟล์

สร้าง Hugging Face token ที่อ่าน/สร้าง/เขียน repository และเริ่ม/จัดการ Jobs ได้ แล้วใส่ในไฟล์ local `.env.speech-training`:

```dotenv
HF_TOKEN=
```

ไฟล์นี้ต้องมี permission `0600` และอยู่ใน `.gitignore` อย่าส่ง token ผ่านแชตหรือใส่ในคำสั่ง/URL ตัวควบคุมอ่านไฟล์นี้โดยตรง ไม่ใช้คีย์ OpenAI หรือเดาคีย์จากไฟล์อื่น ตัว trainer ไม่ได้รับ token; เฉพาะตัว runner ใช้ token สำหรับ Hub

## คำสั่งจาก root โปรเจกต์

ใช้ environment ที่ติดตั้ง `huggingface-hub` แล้ว เช่น `speech-training/.venv/bin/python` บนเครื่องนี้

```sh
python3 speech-training/package_cloud_training.py --scope pilot --output .build/hf-training-pilot
speech-training/.venv/bin/python speech-training/manage_cloud_training.py prepare
speech-training/.venv/bin/python speech-training/manage_cloud_training.py launch
speech-training/.venv/bin/python speech-training/manage_cloud_training.py status
speech-training/.venv/bin/python speech-training/manage_cloud_training.py download
```

หากแพ็กไว้แล้วให้ข้ามคำสั่งแรก ตัวแพ็กไม่เขียนทับ output เดิม `prepare` สร้าง private dataset repository สำหรับ input และ private model repository สำหรับ output แล้วอัปโหลดเฉพาะ `bundle.json` กับ `training-input.tar` มี SHA256 ของ archive และทุกไฟล์ โดยไม่รวมคีย์ เสียงส่วนตัว หรือโฟลเดอร์อื่น

`launch` เป็นขั้นเริ่มคิดค่า GPU เก็บสถานะก่อนส่งคำขอและส่งได้ครั้งเดียว หากอยู่ `launching` เพราะการเชื่อมต่อขาด ห้ามลบสถานะแล้วรันซ้ำทันที ให้ตรวจหน้า Jobs ก่อนเพื่อป้องกันเช่าเครื่องซ้ำ หากต้องหยุด Job ใช้หน้า Jobs หรือ `hf jobs cancel JOB_ID`; ปิด terminal อย่างเดียวไม่หยุด Job

สถานะ local อยู่ `outputs/hf-training-pilot/control.json` ไม่มี token ส่วน input ถูก pin ด้วย full commit SHA ตัว runner ปฏิเสธ repository ที่เป็น public และตรวจไฟล์/ขนาด/hash/path ก่อนรัน

## ไฟล์ที่ได้และการใช้ในโปรเจกต์

`download` เก็บผลใต้ `outputs/hf-training-pilot/model-result/runs/cloud-.../` ประกอบด้วยแผนงาน ผลงาน manifest และ `training-output.tar` เมื่อการเทรนสำเร็จ archive จะมี:

- `training/candidate/model.safetensors` พร้อม config/vocabulary/feature extractor สำหรับโหลดใน Python
- `training/checkpoint.pt` และ `run-config.json` สำหรับตรวจ recipe/พิจารณา resume ที่ตรงกัน
- ผล evaluation และ log ซึ่งแยกจากผลของผู้เรียน

ต้องตรวจ SHA256 กับ `output-manifest.json` ก่อนแตกไฟล์ และตรวจ `training_completed`/`candidate_weights_available` จากผลจริง ไม่ถือว่ามีไฟล์แล้วแปลว่าโมเดลดีขึ้น ห้ามโหลด checkpoint pickle จากแหล่งที่ไม่เชื่อถือ

การใช้ในเว็บ/iPhone ยังต้อง export เป็น ONNX และทดสอบความตรงกัน ความเร็ว และหน่วยความจำก่อนสลับโมเดล งานนี้ยังไม่ export ONNX หรือ deploy น้ำหนักโมเดลใหม่อัตโนมัติ

## ข้อมูลฝึกที่เหมาะสม

100.58 ชั่วโมง LibriSpeech เดิมมีอยู่แล้ว ไม่ต้องซื้อหรือดาวน์โหลดซ้ำ สามารถแพ็ก `--scope full` แยกไว้ได้ แต่ runner รอบนี้รับเฉพาะ pilot เพื่อควบคุมค่าใช้จ่าย ป้าย phoneme มาจาก canonical eSpeak ของข้อความ ไม่ใช่ผู้เชี่ยวชาญฟังและให้คะแนนเสียงจริง การเพิ่มข้อมูลเจ้าของภาษาอย่างเดียวจึงยังไม่ยืนยันว่าระบบชี้ข้อผิดพลาดของผู้เรียนไทยได้ถูกต้อง

ตัวเลือกถัดไปที่ตรวจแหล่งข้อมูลแล้วคือ VCTK 0.92 สำหรับเสียงหลายผู้พูด/สำเนียง, Speech Commands สำหรับคำสั้นที่มีคำศัพท์จำกัด และ speechocean762 สำหรับคะแนนผู้เชี่ยวชาญ (ผู้พูดภาษาจีนเป็นภาษาแม่ ไม่ใช่เจ้าของภาษาอังกฤษหรือข้อมูลผู้เรียนไทย) ตรวจ license และสิทธิ์เข้าถึงของแต่ละชุดก่อนเพิ่ม

แหล่งทางการ: [HF Jobs](https://huggingface.co/docs/hub/jobs-quickstart), [ราคาและ timeout](https://huggingface.co/docs/hub/jobs-pricing), [LibriSpeech](https://www.openslr.org/12), [VCTK](https://datashare.ed.ac.uk/items/30e7453c-9ea8-48b4-8e18-f96d0dc62928), [Speech Commands](https://research.google/blog/launching-the-speech-commands-dataset/), [speechocean762](https://www.openslr.org/101)
