/* Original Thai-supported beginner scripts. No network calls or scoring logic.
 * Listening transcripts/hints must be gated by the engine; see CONTENT.md. */
globalThis.EGL_CONTENT = {
  "version": "1.0.0",
  "lessons": [
    {
      "id": "G01",
      "title": "สวนของฉัน",
      "eyebrow": "บทที่ 1 · ใบไม้หนึ่งใบ",
      "description": "เริ่มจากภาพพืช ฟังและอ่านประโยคสั้น ลองเขียน แล้วพูดกับตัวเองเมื่อพร้อม",
      "minutes": 10,
      "theme": "garden",
      "goal": "รู้ความหมายของ leaf และเขียน This is a leaf. ได้ ลองพูดได้โดยเลือกข้ามการพูดได้",
      "words": [
        {
          "en": "leaf",
          "th": "ใบไม้หนึ่งใบ",
          "example": "This is a leaf."
        },
        {
          "en": "plant",
          "th": "ต้นไม้ / พืช",
          "example": "This is my plant."
        },
        {
          "en": "green",
          "th": "สีเขียว",
          "example": "The leaf is green."
        }
      ],
      "intro": {
        "en": "This is a leaf.",
        "th": "นี่คือใบไม้หนึ่งใบ — This is… ใช้บอกว่านี่คืออะไร; a leaf คือใบไม้หนึ่งใบ"
      },
      "listen": {
        "prompt": "กดฟังประโยค แล้วเลือกสิ่งที่เสียงพูดถึง ถ้ายังไม่แน่ใจ ฟังซ้ำหรือเปิดคำช่วยได้",
        "audio": "This is a leaf.",
        "question": "เสียงนี้พูดถึงอะไร?",
        "choices": [
          {
            "id": "g-listen-plant",
            "text": "ต้นไม้หนึ่งต้น"
          },
          {
            "id": "g-listen-leaf",
            "text": "ใบไม้หนึ่งใบ"
          },
          {
            "id": "g-listen-water",
            "text": "น้ำ"
          }
        ],
        "correctId": "g-listen-leaf",
        "feedback": "leaf หมายถึงใบไม้ ประโยค This is a leaf. บอกว่า “นี่คือใบไม้หนึ่งใบ” ส่วน plant คือพืชหรือต้นไม้"
      },
      "read": {
        "text": "This is my plant. The leaf is green.",
        "question": "อ่านสองประโยคนี้: ใบไม้มีสีอะไร?",
        "choices": [
          {
            "id": "g-read-red",
            "text": "สีแดง"
          },
          {
            "id": "g-read-blue",
            "text": "สีน้ำเงิน"
          },
          {
            "id": "g-read-green",
            "text": "สีเขียว"
          }
        ],
        "correctId": "g-read-green",
        "feedback": "The leaf is green. หมายถึง “ใบไม้มีสีเขียว” คำว่า green บอกสี; This is my plant. แปลว่า “นี่คือต้นไม้ของฉัน”"
      },
      "write": {
        "prompt": "ลองเขียนประโยคเต็มว่า “นี่คือใบไม้หนึ่งใบ” ใช้ This / is / a / leaf จะค่อย ๆ ต่อทีละคำก็ได้",
        "scaffold": "This is a ____.",
        "accepted": [
          "This is a leaf."
        ],
        "hint": "เริ่มด้วย This is a แล้วเติม leaf ให้ครบประโยค: This is a leaf.",
        "feedback": "ประโยคเป้าหมายคือ This is a leaf. บทนี้ตรวจรูปแบบประโยคที่กำหนด ลองซ่อนคำช่วยแล้วเขียนเองอีกครั้งได้"
      },
      "speak": {
        "prompt": "ถ้าพร้อม ลองพูดประโยคตาม 1 ครั้ง แล้วมองภาพและลองพูดเอง เลือกข้ามได้ กิจกรรมนี้ใช้การสะท้อนตนเอง ไม่เปิดไมค์หรือให้คะแนนเสียง",
        "model": "This is a leaf."
      },
      "recall": {
        "prompt": "ลองนึกเองก่อนเปิดคำช่วย: คำภาษาอังกฤษที่แปลว่า “ใบไม้หนึ่งใบ” คือคำอะไร? พิมพ์เพียงคำเดียว",
        "accepted": [
          "leaf"
        ],
        "hint": "คำนี้ขึ้นต้นด้วย l และเคยอยู่ในประโยค This is a leaf.",
        "feedback": "คำที่กำลังทบทวนคือ leaf = ใบไม้หนึ่งใบ การตอบโดยไม่เปิดคำช่วยกับการตอบหลังเปิดคำช่วยจะเก็บแยกกัน"
      },
      "dialogue": {
        "prompt": "มะลิถามเรื่องสิ่งที่เราชี้อยู่ ลองเลือกคำตอบให้ตรงใบไม้ บทสนทนานี้เป็นสคริปต์ที่เตรียมไว้ ไม่ได้คุยกับ AI สด",
        "lines": [
          {
            "speaker": "Mali",
            "en": "Hello! This is my plant.",
            "th": "สวัสดี นี่คือต้นไม้ของฉัน"
          },
          {
            "speaker": "Mali",
            "en": "What is this?",
            "th": "นี่คืออะไร? เรากำลังชี้ใบไม้หนึ่งใบ"
          }
        ],
        "choices": [
          {
            "id": "g-dialogue-plant",
            "text": "This is my plant. — นี่คือต้นไม้ของฉัน",
            "reply": "ประโยคนี้ใช้บอกต้นไม้ทั้งต้นได้ แต่ตอนนี้มะลิถามถึงใบไม้หนึ่งใบ ลองเลือกประโยคที่ใช้ leaf",
            "helpful": false
          },
          {
            "id": "g-dialogue-leaf",
            "text": "This is a leaf. — นี่คือใบไม้หนึ่งใบ",
            "reply": "Mali: Yes, a leaf. Thank you! — ใช่ ใบไม้ ขอบคุณค่ะ",
            "helpful": true
          },
          {
            "id": "g-dialogue-colour",
            "text": "The leaf is green. — ใบไม้มีสีเขียว",
            "reply": "ประโยคนี้บอกสีได้ถูกบริบท แต่คำถาม What is this? ถามว่าสิ่งนี้คืออะไร ลองตอบ This is a leaf.",
            "helpful": false
          }
        ]
      }
    },
    {
      "id": "A01",
      "title": "ขอให้ AI ช่วย",
      "eyebrow": "บทที่ 2 · ขอความช่วยเหลืออย่างสุภาพ",
      "description": "ฝึกคำขอที่ใช้กับ AI ได้ เริ่มจาก “ช่วยฉันหน่อย” แล้วอ่านคำขอให้เขียนหนึ่งประโยคเกี่ยวกับใบไม้",
      "minutes": 10,
      "theme": "ai",
      "goal": "เข้าใจคำขอช่วย เขียน Help me, please. ได้ และอ่านว่าเราขอให้ AI เขียนเรื่องอะไร",
      "words": [
        {
          "en": "help",
          "th": "ช่วย",
          "example": "Help me, please."
        },
        {
          "en": "write",
          "th": "เขียน",
          "example": "Write one sentence about a leaf."
        },
        {
          "en": "ask",
          "th": "ถาม / ขอ",
          "example": "Ask AI for help."
        }
      ],
      "intro": {
        "en": "Help me, please.",
        "th": "ช่วยฉันหน่อยได้ไหม — help คือช่วย; me คือฉันในประโยคนี้; please ช่วยทำให้คำขอสุภาพ"
      },
      "listen": {
        "prompt": "ฟังคำขอสั้น ๆ แล้วเลือกว่าผู้พูดต้องการทำอะไร ฟังซ้ำได้",
        "audio": "Help me, please.",
        "question": "ผู้พูดกำลังขออะไร?",
        "choices": [
          {
            "id": "a-listen-help",
            "text": "ขอความช่วยเหลืออย่างสุภาพ"
          },
          {
            "id": "a-listen-colour",
            "text": "บอกสีของใบไม้"
          },
          {
            "id": "a-listen-name",
            "text": "บอกชื่อของตัวเอง"
          }
        ],
        "correctId": "a-listen-help",
        "feedback": "Help me, please. เป็นคำขอความช่วยเหลืออย่างสุภาพ ยังไม่ได้บอกให้ผู้ช่วยทำงานเฉพาะอะไร จึงอาจต้องบอกคำขอเพิ่ม"
      },
      "read": {
        "text": "Write one sentence about a leaf.",
        "question": "อ่านคำขอนี้: เราขอให้เขียนเกี่ยวกับอะไร?",
        "choices": [
          {
            "id": "a-read-water",
            "text": "น้ำ"
          },
          {
            "id": "a-read-name",
            "text": "ชื่อของเรา"
          },
          {
            "id": "a-read-leaf",
            "text": "ใบไม้"
          }
        ],
        "correctId": "a-read-leaf",
        "feedback": "about a leaf คือ “เกี่ยวกับใบไม้” ส่วน Write one sentence คือ “เขียนหนึ่งประโยค” ทั้งประโยคจึงขอให้เขียนหนึ่งประโยคเกี่ยวกับใบไม้"
      },
      "write": {
        "prompt": "เขียนคำขอเต็มว่า “ช่วยฉันหน่อยได้ไหม” โดยใช้ help / me / please จะวาง please ข้างหน้าหรือข้างหลังก็ได้",
        "scaffold": "____ me, ____.",
        "accepted": [
          "Help me, please.",
          "Help me please.",
          "Please help me."
        ],
        "hint": "เขียนได้ว่า Help me, please. หรือ Please help me. ทั้งสองแบบเป็นคำขอสุภาพ",
        "feedback": "รูปแบบที่บทนี้ยอมรับคือ Help me, please. และ Please help me. การตรวจเป็นการเทียบประโยคที่เตรียมไว้ ไม่ใช่ AI ตัดสินความหมายของประโยคอิสระ"
      },
      "speak": {
        "prompt": "ลองพูดขอความช่วยเหลือเหมือนกำลังคุยกับผู้ช่วย ใช้ตัวอย่างก่อนแล้วค่อยลองพูดเอง เลือกข้ามได้ ไม่มีการเปิดไมค์หรือให้คะแนนเสียง",
        "model": "Help me, please."
      },
      "recall": {
        "prompt": "ลองนึกก่อนเปิดคำช่วย: คำกริยาภาษาอังกฤษที่แปลว่า “ช่วย” คืออะไร? พิมพ์เพียงคำเดียว",
        "accepted": [
          "help"
        ],
        "hint": "คำนี้ขึ้นต้นด้วย h และอยู่ในคำขอ Help me, please.",
        "feedback": "คำที่กำลังทบทวนคือ help = ช่วย ถ้าเปิดคำช่วยแล้วตอบได้ แปลว่าใช้ตัวช่วยสำเร็จ ยังแยกจากการนึกได้เอง"
      },
      "dialogue": {
        "prompt": "ห้องทดลองนี้จำลองการขอให้ AI ช่วย เลือกคำขอที่บอกว่าอยากได้ “หนึ่งประโยคเกี่ยวกับใบไม้” คำตอบด้านล่างเป็นสคริปต์ ไม่ได้เรียก AI สด",
        "lines": [
          {
            "speaker": "You",
            "en": "Help me, please.",
            "th": "ช่วยฉันหน่อยได้ไหม"
          },
          {
            "speaker": "AI",
            "en": "What do you need?",
            "th": "ต้องการให้ช่วยอะไร?"
          }
        ],
        "choices": [
          {
            "id": "a-dialogue-sentence",
            "text": "Write one sentence about a leaf. — เขียนหนึ่งประโยคเกี่ยวกับใบไม้",
            "reply": "AI ตัวอย่าง: The leaf is green. — ใบไม้มีสีเขียว นี่เป็นประโยคที่เตรียมไว้ ไม่ใช่ข้อมูลที่อ่านจากต้นไม้จริง",
            "helpful": true
          },
          {
            "id": "a-dialogue-leaf",
            "text": "This is a leaf. — นี่คือใบไม้หนึ่งใบ",
            "reply": "ประโยคนี้บอกว่าสิ่งนี้คือใบไม้ แต่ยังไม่ได้ขอให้เขียนอะไร ลองใช้ Write one sentence about a leaf.",
            "helpful": false
          },
          {
            "id": "a-dialogue-thanks",
            "text": "Thank you. — ขอบคุณ",
            "reply": "Thank you. ใช้ขอบคุณได้ แต่ตอนนี้เรายังไม่ได้บอกงานที่อยากให้ช่วย ลองเลือกคำขอให้เขียนหนึ่งประโยค",
            "helpful": false
          }
        ]
      }
    },
    {
      "id": "C01",
      "title": "คุยกับมะลิ",
      "eyebrow": "บทที่ 3 · ความชอบและการขอพูดซ้ำ",
      "description": "คุยเรื่องพืชกับมะลิ ตัวละครผู้ใหญ่สมมติ บอกความชอบของตัวเองได้ และขอให้พูดอีกครั้งได้เมื่อยังฟังไม่ทัน",
      "minutes": 10,
      "theme": "conversation",
      "goal": "อ่านความชอบของคู่สนทนา เขียน I like plants. ตามโจทย์ และรู้จักขอให้พูดอีกครั้ง โดยไม่ให้คะแนนจากความชอบส่วนตัว",
      "words": [
        {
          "en": "like",
          "th": "ชอบ",
          "example": "I like plants."
        },
        {
          "en": "plants",
          "th": "พืช / ต้นไม้หลายต้น",
          "example": "I like plants."
        },
        {
          "en": "again",
          "th": "อีกครั้ง",
          "example": "Please say it again."
        }
      ],
      "intro": {
        "en": "I like plants.",
        "th": "ฉันชอบพืชหรือต้นไม้ — like คือชอบ; plants คือรูปพหูพจน์ของ plant ใช้พูดถึงพืชโดยทั่วไปในประโยคนี้"
      },
      "listen": {
        "prompt": "ฟังประโยคที่ช่วยให้เราคุยต่อได้ แล้วเลือกว่าผู้พูดต้องการอะไร",
        "audio": "Please say it again.",
        "question": "ผู้พูดอยากให้คู่สนทนาทำอะไร?",
        "choices": [
          {
            "id": "c-listen-write",
            "text": "เขียนเรื่องใบไม้"
          },
          {
            "id": "c-listen-repeat",
            "text": "พูดอีกครั้ง"
          },
          {
            "id": "c-listen-name",
            "text": "บอกชื่อตัวเอง"
          }
        ],
        "correctId": "c-listen-repeat",
        "feedback": "Please say it again. หมายถึง “กรุณาพูดอีกครั้ง” ใช้เมื่อยังฟังไม่ทันหรืออยากฟังซ้ำได้ คำว่า again คืออีกครั้ง"
      },
      "read": {
        "text": "Mali: I like plants.",
        "question": "อ่านคำพูดของมะลิ: เธอชอบอะไร?",
        "choices": [
          {
            "id": "c-read-plants",
            "text": "พืชหรือต้นไม้"
          },
          {
            "id": "c-read-names",
            "text": "ชื่อภาษาอังกฤษ"
          },
          {
            "id": "c-read-writing",
            "text": "การเขียนประโยค"
          }
        ],
        "correctId": "c-read-plants",
        "feedback": "I like plants. คือ “ฉันชอบพืชหรือต้นไม้” เป็นความชอบของมะลิในบทตัวอย่าง ผู้เรียนมีความชอบต่างจากตัวละครได้"
      },
      "write": {
        "prompt": "สำหรับแบบฝึกรูปประโยคนี้ ให้เขียนว่า “ฉันชอบต้นไม้” ด้วย I / like / plants เป็นประโยคที่โจทย์กำหนด ไม่ใช่แบบสำรวจว่าคุณต้องชอบจริง",
        "scaffold": "I ____ ____.",
        "accepted": [
          "I like plants."
        ],
        "hint": "เรียงเป็น I like plants. — I คือฉัน; like คือชอบ; plants คือพืชหรือต้นไม้โดยทั่วไป",
        "feedback": "รูปประโยคของแบบฝึกคือ I like plants. เราตรวจประโยคที่โจทย์กำหนดเท่านั้น ในบทสนทนาถัดไปเลือกตอบตามความชอบจริงของคุณได้"
      },
      "speak": {
        "prompt": "ลองพูดประโยคขอให้คู่สนทนาพูดอีกครั้ง ฟัง/อ่านตัวอย่างแล้วลองพูดเอง เลือกข้ามได้ ใช้การสะท้อนตนเอง ไม่มีการเปิดไมค์หรือให้คะแนนเสียง",
        "model": "Please say it again."
      },
      "recall": {
        "prompt": "ลองนึกก่อนเปิดคำช่วย: คำภาษาอังกฤษที่แปลว่า “อีกครั้ง” คืออะไร? พิมพ์เพียงคำเดียว",
        "accepted": [
          "again"
        ],
        "hint": "คำนี้ขึ้นต้นด้วย a และอยู่ท้ายประโยค Please say it again.",
        "feedback": "คำที่กำลังทบทวนคือ again = อีกครั้ง การทำข้อนี้ทันทีเป็นการฝึกนึกคำ ยังไม่ใช่ผลจำได้หลังเว้นหลายวัน"
      },
      "dialogue": {
        "prompt": "คุยกับมะลิเรื่องความชอบ เลือกคำตอบตามที่อยากพูดได้ ทั้งชอบ ไม่ชอบ และขอฟังซ้ำเป็นคำตอบที่เหมาะสม บทนี้เป็นสคริปต์กับตัวละครผู้ใหญ่สมมติ ไม่ใช่ AI สด",
        "lines": [
          {
            "speaker": "Mali",
            "en": "I like plants.",
            "th": "ฉันชอบต้นไม้"
          },
          {
            "speaker": "Mali",
            "en": "Do you like plants?",
            "th": "คุณชอบต้นไม้ไหม?"
          }
        ],
        "choices": [
          {
            "id": "c-dialogue-repeat",
            "text": "Please say it again. — ช่วยพูดอีกครั้งได้ไหม",
            "reply": "Mali: Do you like plants? — คุณชอบต้นไม้ไหม? ขอให้พูดซ้ำได้เสมอ ไม่ต้องเดาคำตอบเมื่อฟังไม่ทัน",
            "helpful": true
          },
          {
            "id": "c-dialogue-yes",
            "text": "Yes, I do. — ชอบครับ/ค่ะ",
            "reply": "Mali: Thank you! — ขอบคุณที่เล่าให้ฟังค่ะ ถ้าต้องการขยายความ ใช้ I like plants. ได้",
            "helpful": true
          },
          {
            "id": "c-dialogue-no",
            "text": "No, I don't. — ไม่ชอบครับ/ค่ะ",
            "reply": "Mali: Thank you! — ขอบคุณที่เล่าให้ฟังค่ะ ความชอบต่างกันได้ คุณไม่ได้ตอบผิดเพราะไม่ชอบต้นไม้",
            "helpful": true
          }
        ]
      }
    }
  ],
  "glossary": [
    {
      "id": "leaf",
      "en": "leaf",
      "th": "ใบไม้หนึ่งใบ",
      "example": "This is a leaf."
    },
    {
      "id": "plant",
      "en": "plant",
      "th": "ต้นไม้ / พืช",
      "example": "This is my plant."
    },
    {
      "id": "green",
      "en": "green",
      "th": "สีเขียว",
      "example": "The leaf is green."
    },
    {
      "id": "help",
      "en": "help",
      "th": "ช่วย",
      "example": "Help me, please."
    },
    {
      "id": "write",
      "en": "write",
      "th": "เขียน",
      "example": "Write one sentence about a leaf."
    },
    {
      "id": "ask",
      "en": "ask",
      "th": "ถาม / ขอ",
      "example": "Ask AI for help."
    },
    {
      "id": "like",
      "en": "like",
      "th": "ชอบ",
      "example": "I like plants."
    },
    {
      "id": "plants",
      "en": "plants",
      "th": "พืช / ต้นไม้หลายต้น; รูปพหูพจน์ของ plant",
      "example": "I like plants."
    },
    {
      "id": "again",
      "en": "again",
      "th": "อีกครั้ง",
      "example": "Please say it again."
    },
    {
      "id": "please",
      "en": "please",
      "th": "คำช่วยให้คำขอสุภาพ เช่น กรุณา / หน่อยได้ไหม",
      "example": "Please help me."
    },
    {
      "id": "sentence",
      "en": "sentence",
      "th": "ประโยค",
      "example": "Write one sentence."
    },
    {
      "id": "one",
      "en": "one",
      "th": "หนึ่ง",
      "example": "Write one sentence."
    },
    {
      "id": "about",
      "en": "about",
      "th": "เกี่ยวกับ",
      "example": "Write one sentence about a leaf."
    },
    {
      "id": "say",
      "en": "say",
      "th": "พูด / กล่าว",
      "example": "Please say it again."
    },
    {
      "id": "my",
      "en": "my",
      "th": "ของฉัน",
      "example": "This is my plant."
    },
    {
      "id": "this-is",
      "en": "This is…",
      "th": "นี่คือ… ใช้บอกว่าสิ่งนี้คืออะไร",
      "example": "This is a leaf."
    },
    {
      "id": "what-is-this",
      "en": "What is this?",
      "th": "นี่คืออะไร?",
      "example": "What is this? This is a leaf."
    },
    {
      "id": "thank-you",
      "en": "Thank you.",
      "th": "ขอบคุณ",
      "example": "Thank you!"
    },
    {
      "id": "yes-i-do",
      "en": "Yes, I do.",
      "th": "ตอบรับว่าชอบ เมื่อถูกถาม Do you like…?",
      "example": "Do you like plants? Yes, I do."
    },
    {
      "id": "no-i-dont",
      "en": "No, I don't.",
      "th": "ตอบว่าไม่ชอบ เมื่อถูกถาม Do you like…?",
      "example": "Do you like plants? No, I don't."
    }
  ],
  "plantSample": {
    "label": "ข้อมูลจำลองสำหรับฝึกอ่าน ไม่ใช่ข้อมูลเซนเซอร์สด และไม่ใช้สั่งปั๊มหรือไฟ",
    "temperature": 28,
    "light": 860,
    "moisture": 42
  }
};
