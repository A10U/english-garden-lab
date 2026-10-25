# English Garden Lab — สวนภาษา AI

เครื่องมือฝึกภาษาอังกฤษสำหรับผู้เริ่มต้น มีคำแปลและตัวช่วยภาษาไทย

**[เปิดเดโมออนไลน์](https://a10u.github.io/english-garden-lab/)** · [GitHub repository](https://github.com/A10U/english-garden-lab)

- **[Learning App](app/index.html)** — 3 บทเรียน สวนคำศัพท์ และความก้าวหน้าที่บันทึกในเบราว์เซอร์
- **[Speech Training](speech-training/listen.html)** — 24 ประโยค ตัวอย่างเสียง AI, IPA, ฟังรายคำ และบันทึกเสียงตัวเอง

เปิด `index.html` เพื่อเลือก App หรือ Speech Training

## เปิดเดโมในเครื่อง

ต้องมี Python 3 และใช้ HTTPS หรือ localhost เพื่อบันทึกเสียง:

```sh
python3 speech-training/build_demo.py
python3 -m http.server 8080 --directory dist
```

เปิด http://localhost:8080 แล้วอนุญาตไมโครโฟนเมื่อต้องการบันทึกเสียง เดโมใช้ผลวิเคราะห์เสียง AI ที่เตรียมไว้ล่วงหน้า ไม่ส่งเสียงที่บันทึกใหม่ไปวิเคราะห์ ส่วนการประเมินเสียงของผู้เรียนแบบสดต้องเปิดบริการ Python ตาม [คู่มือ Speech Training](speech-training/README.md)

## ตรวจสอบ

```sh
npm ci --prefix app
npm test --prefix app
python3 speech-training/export_demo_assets.py --verify
```

ข้อมูลเสียงตัวอย่างและเครดิตอยู่ใน [demo-assets/ATTRIBUTION.txt](speech-training/demo-assets/ATTRIBUTION.txt) ตัวเลขเปอร์เซ็นต์เป็นผลประมาณจากโมเดลสำหรับช่วยฝึก ไม่ใช่คะแนนมาตรฐานรับรองการออกเสียง

## ขอบเขต repository

เผยแพร่เฉพาะ App, Speech Training และหน้าเลือกเดโม ไม่รวม `SDLC/`, `Resource/`, โมเดล, dataset ที่ดาวน์โหลด, training runs, environment, log หรือเสียงส่วนตัว การฝึกโมเดลต้องเตรียมข้อมูลและดาวน์โหลดโมเดลแยกตามคู่มือ
