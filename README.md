# English Garden Lab — สวนภาษา AI

เครื่องมือฝึกภาษาอังกฤษสำหรับผู้เริ่มต้น มีคำแปลและตัวช่วยภาษาไทย

**[เปิดเดโมออนไลน์](https://a10u.github.io/english-garden-lab/)** · [GitHub repository](https://github.com/A10U/english-garden-lab)

- **[Learning App](app/index.html)** — 3 บทเรียน สวนคำศัพท์ และความก้าวหน้าที่บันทึกในเบราว์เซอร์
- **[Speech Training](speech-training/listen.html)** — 24 ประโยค ตัวอย่างเสียง AI, IPA, ฟังรายคำ และวิเคราะห์เสียงที่บันทึกในเบราว์เซอร์

เปิด `index.html` เพื่อเลือก App หรือ Speech Training

## เปิดเดโมในเครื่อง

ต้องมี Python 3 และใช้ HTTPS หรือ localhost เพื่อบันทึกเสียง:

```sh
python3 speech-training/build_demo.py
python3 -m http.server 8080 --directory dist
```

เปิด http://localhost:8080 แล้วอนุญาตไมโครโฟนเมื่อต้องการบันทึกเสียง กดดูผลเพื่อวิเคราะห์เสียงของคุณในเบราว์เซอร์ ครั้งแรกดาวน์โหลดโมเดลประมาณ **318 MB** จาก Hugging Face และชุดประมวลผลประมาณ **12 MB** จากเว็บนี้ เสียงที่บันทึกไม่ถูกส่งไปเซิร์ฟเวอร์ ส่วนผลของเสียง AI เป็นข้อมูลที่เตรียมไว้แยกกัน การฟังตัวอย่างและเรียนบทเรียนไม่ต้องดาวน์โหลดโมเดล

การวิเคราะห์ใช้หน่วยความจำมากกว่าขนาดไฟล์โมเดลและอาจช้าในโทรศัพท์หรือเครื่องเก่า ลองเริ่มจากคำหรือประโยคสั้น ๆ หากอุปกรณ์ไม่รองรับยังฟังและอัดเสียงได้ หรือใช้ [บริการวิเคราะห์ในเครื่อง](speech-training/README.md#local-service)

## ตรวจสอบ

```sh
npm ci --prefix app
npm test --prefix app
python3 speech-training/export_demo_assets.py --verify
```

ข้อมูลเสียงตัวอย่างและเครดิตอยู่ใน [demo-assets/ATTRIBUTION.txt](speech-training/demo-assets/ATTRIBUTION.txt) ตัวเลขเปอร์เซ็นต์เป็นผลประมาณจากโมเดลสำหรับช่วยฝึก ไม่ใช่คะแนนมาตรฐานรับรองการออกเสียง

## ขอบเขต repository

เผยแพร่เฉพาะ App, Speech Training และหน้าเลือกเดโม ไม่รวม `SDLC/`, `Resource/`, model weights, dataset ที่ดาวน์โหลด, training runs, environment, log หรือเสียงส่วนตัว รวม ONNX Runtime Web 1.23.2 สำหรับประมวลผลในเบราว์เซอร์ โมเดล phoneme แบบ quantized ดาวน์โหลดจาก revision ที่ระบุไว้เมื่อผู้ใช้กดวิเคราะห์ การฝึก TTS ต้องเตรียมข้อมูลและดาวน์โหลดโมเดลแยกตามคู่มือ
