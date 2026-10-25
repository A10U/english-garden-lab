/* Original Thai meaning aids for the project's authored English examples.
 * This is a curated lookup, not machine translation. Unknown text returns null.
 * Chunk indices use the same English word/contraction pattern as the backend.
 * No Thai sound-alike spellings, quiz answers or pronunciation grades are added.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLStudyHelp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WORD_MEANINGS = {
    '5': 'ห้า', a: 'หนึ่ง; ใช้นำหน้าสิ่งหนึ่งอย่าง', about: 'เกี่ยวกับ', add: 'เติม', again: 'อีกครั้ง',
    ai: 'ปัญญาประดิษฐ์; ผู้ช่วย AI', always: 'เสมอ; ได้ทุกเมื่อ', and: 'และ; แล้วก็', any: 'บ้าง; สักหน่อย',
    ask: 'ขอ; ถาม', at: 'ที่; ตาม', back: 'กลับมา', basil: 'โหระพา', be: 'เป็น; อยู่', been: 'เป็น; ผ่านมา',
    before: 'ก่อน', beside: 'ข้าง ๆ', break: 'การพัก', but: 'แต่', can: 'ทำได้; สามารถ', check: 'ตรวจดู',
    choose: 'เลือก', come: 'มา', could: 'ช่วย…ได้ไหม; อาจจะ', day: 'วัน', difference: 'ความแตกต่าง',
    do: 'คำช่วยถามหรือตอบเรื่องการกระทำ', "doesn't": 'ไม่; ไม่ได้ (ใช้กับสิ่งเดียว)', "don't": 'ไม่; ไม่ได้',
    down: 'ลง; ให้ลดลง', dry: 'แห้ง', easier: 'ง่ายกว่า', every: 'ทุก', example: 'ตัวอย่าง', finish: 'จบ; เสร็จ',
    first: 'ก่อน; เป็นอย่างแรก', flower: 'ดอกไม้', for: 'เพื่อ; เป็นเวลา', from: 'จาก', garden: 'สวน',
    get: 'ทำให้; เข้าใจให้ได้', give: 'ให้; ยกตัวอย่างให้', good: 'ดี', green: 'สีเขียว', growing: 'การปลูก',
    has: 'คำช่วยพูดถึงสิ่งที่ผ่านมา', have: 'มี; ใช้ใน have to ว่าต้อง', hear: 'ได้ยิน; ฟัง', help: 'ช่วย',
    hi: 'สวัสดี', hint: 'คำใบ้; คำช่วย', hmm: 'เสียงขณะกำลังคิด', how: 'อย่างไร; เป็นอย่างไร', i: 'ฉัน',
    "i'm": 'ฉันเป็น; ฉันชื่อ', in: 'ใน', is: 'คือ; เป็น; มีลักษณะ', it: 'มัน; สิ่งนั้น; ประโยคนั้น',
    "it's": 'มันเป็น; นั่นเป็น', leaf: 'ใบไม้หนึ่งใบ', learned: 'เรียนรู้แล้ว', leaves: 'ใบไม้หลายใบ',
    let: 'ให้; ขอให้', "let's": 'มา…กันเถอะ', like: 'ชอบ', listen: 'ฟังอย่างตั้งใจ', little: 'เล็กน้อย; นิดหน่อย',
    look: 'ดู', looks: 'ดูเหมือน; ดูมีลักษณะ', mali: 'มะลิ (ชื่อผู้ช่วย)', me: 'ฉัน (ผู้ที่ได้รับการกระทำ)',
    mean: 'หมายถึง', minutes: 'นาที', most: 'มากที่สุด', my: 'ของฉัน', near: 'ใกล้', need: 'จำเป็นต้อง; ต้องการ',
    new: 'ใหม่', nice: 'ดี; น่าชื่นชม', no: 'ไม่', notice: 'สังเกตเห็น', now: 'ตอนนี้; คราวนี้',
    of: 'ของ', oh: 'อ้อ; โอ้', okay: 'ไม่เป็นไร; ตกลง', one: 'หนึ่ง', or: 'หรือ', own: 'ของตนเอง',
    pace: 'จังหวะ; ความเร็วที่ถนัด', perfect: 'สมบูรณ์แบบ', plant: 'ต้นไม้หนึ่งต้น; พืช', plants: 'ต้นไม้หลายต้น; พืช',
    please: 'กรุณา; ช่วยให้คำขอสุภาพ', pot: 'กระถาง', practice: 'ฝึก', rather: 'อยาก…มากกว่า',
    ready: 'พร้อม', really: 'จริงเหรอ; จริง ๆ', remember: 'จำไว้', remembered: 'จำได้แล้ว', right: 'ถูกต้อง',
    root: 'ราก', say: 'พูด', see: 'เห็น; เข้าใจ', sentence: 'ประโยค', short: 'สั้น; สักครู่', slow: 'ช้า',
    slower: 'ช้าลง; ช้ากว่า', small: 'เล็ก', soft: 'นุ่ม', soil: 'ดิน', something: 'บางอย่าง; อะไรสักอย่าง',
    spend: 'ใช้เวลา', start: 'เริ่ม', step: 'ก้าว; ขั้นเล็ก ๆ', take: 'ใช้; ทำ (ดูความหมายทั้งวลี)',
    talk: 'พูดคุย', talking: 'การพูดคุย', tell: 'บอก', thank: 'ขอบคุณ', that: 'นั้น; เรื่องนั้น',
    "that's": 'นั่นคือ; เรื่องนั้น', the: 'สิ่งที่กำลังพูดถึง', then: 'แล้วจึง', "there's": 'มี…อยู่',
    thing: 'สิ่ง; เรื่อง', think: 'คิด', this: 'นี่; สิ่งนี้', three: 'สาม', time: 'เวลา; ครั้ง',
    tiny: 'เล็กมาก', to: 'เพื่อ; ให้; ใช้เชื่อมกับสิ่งที่จะทำ', today: 'วันนี้', together: 'ด้วยกัน',
    tomorrow: 'พรุ่งนี้', top: 'ส่วนบน; ยอด', try: 'ลอง', two: 'สอง', us: 'พวกเรา', water: 'น้ำ',
    we: 'เรา', welcome: 'ยินดีต้อนรับ', what: 'อะไร', when: 'เมื่อ', with: 'กับ; ด้วย',
    without: 'โดยไม่มี; โดยไม่ต้องใช้', word: 'คำ', words: 'คำหลายคำ', work: 'สิ่งที่ทำได้; ผลงาน',
    would: 'คำช่วยถามความต้องการอย่างสุภาพ', write: 'เขียน', yes: 'ใช่', you: 'คุณ',
    "you'd": 'คุณอยาก… (ในประโยคนี้)', "you're": 'คุณเป็น; คุณอยู่', "you've": 'คุณได้…แล้ว', your: 'ของคุณ'
  };

  // [English, whole meaning, one practical point, [[word count, chunk meaning], ...]]
  const ENTRIES = [
    ['A little slower this time. Could you say that again, please?', 'ครั้งนี้ขอช้าลงอีกนิดนะ ช่วยพูดแบบนั้นอีกครั้งได้ไหม',
      'ใช้ประโยคหลังเพื่อขอให้คู่สนทนาพูดซ้ำอย่างสุภาพ', [[5, 'ครั้งนี้ขอช้าลงอีกนิด'], [6, 'ช่วยพูดแบบนั้นอีกครั้งได้ไหม']]],
    ['AI can help us practice, but you can always ask me to slow down.', 'AI ช่วยเราฝึกได้ แต่คุณขอให้ฉันพูดช้าลงได้เสมอ',
      'slow down ในที่นี้หมายถึงพูดให้ช้าลง ไม่ได้หมายถึงเดินช้าลง', [[5, 'AI ช่วยเราฝึกได้'], [6, 'แต่คุณขอฉันได้เสมอ'], [3, 'ให้พูดช้าลง']]],
    ['Ask AI for help.', 'ขอความช่วยเหลือจาก AI', 'ask … for help เป็นกลุ่มคำที่ใช้ขอความช่วยเหลือ', [[4, 'ขอความช่วยเหลือจาก AI']]],
    ["Before we finish, tell me one thing you'd like to remember from today.", 'ก่อนจบ บอกฉันสักอย่างที่คุณอยากจำไว้จากวันนี้',
      "you'd like หมายถึงคุณอยาก ไม่ใช่คุณชอบเพียงอย่างเดียว", [[3, 'ก่อนจบ'], [4, 'บอกฉันสักอย่าง'], [4, 'ที่คุณอยากจำไว้'], [2, 'จากวันนี้']]],
    ['Can you see the new leaves near the top of the plant?', 'คุณเห็นใบใหม่ใกล้ยอดต้นไม้ไหม',
      'leaves คือใบไม้หลายใบ ส่วน leaf คือหนึ่งใบ', [[3, 'คุณเห็นไหม'], [3, 'ใบใหม่'], [3, 'ใกล้ส่วนยอด'], [3, 'ของต้นไม้']]],
    ["Do you like plants? No, I don't.", 'คุณชอบต้นไม้ไหม ไม่ ฉันไม่ชอบ', 'ตอบสั้น ๆ ว่า No, I don’t. ได้ เพราะรู้แล้วว่ากำลังพูดถึงการชอบต้นไม้', [[4, 'คุณชอบต้นไม้ไหม'], [3, 'ไม่ ฉันไม่ชอบ']]],
    ['Do you like plants? Yes, I do.', 'คุณชอบต้นไม้ไหม ใช่ ฉันชอบ', 'Yes, I do. ใช้ตอบรับคำถามที่เริ่มด้วย Do you…?', [[4, 'คุณชอบต้นไม้ไหม'], [3, 'ใช่ ฉันชอบ']]],
    ['Help me, please.', 'ช่วยฉันหน่อย', 'เติม please เพื่อให้คำขอสุภาพขึ้น', [[3, 'ช่วยฉันหน่อย']]],
    ["Hi! I'm Mali. Ready to spend a little time in the garden?", 'สวัสดี ฉันชื่อมะลิ พร้อมใช้เวลาในสวนสักนิดหรือยัง',
      'a little time หมายถึงเวลาสักนิด ไม่จำเป็นต้องใช้เวลานาน', [[3, 'สวัสดี ฉันชื่อมะลิ'], [3, 'พร้อมใช้เวลา'], [3, 'สักนิด'], [3, 'ในสวนหรือยัง']]],
    ['Hmm, let me think. We could start with basil, or choose something easier.', 'ขอฉันคิดสักนิดนะ เราอาจเริ่มจากโหระพา หรือเลือกอะไรที่ง่ายกว่านี้',
      'let me think ใช้ขอเวลาคิดก่อนตอบ', [[4, 'ขอฉันคิดสักนิดนะ'], [3, 'เราอาจเริ่ม'], [2, 'ด้วยโหระพา'], [4, 'หรือเลือกอะไรที่ง่ายกว่านี้']]],
    ['I like plants.', 'ฉันชอบต้นไม้', 'เริ่มด้วย I like แล้วตามด้วยสิ่งที่ชอบ', [[3, 'ฉันชอบต้นไม้']]],
    ['I see what you mean. Could you give me a small example?', 'ฉันเข้าใจที่คุณหมายถึงแล้ว ช่วยยกตัวอย่างสั้น ๆ ให้หน่อยได้ไหม',
      'I see ในที่นี้หมายถึงฉันเข้าใจ ไม่ใช่ฉันมองเห็น', [[5, 'ฉันเข้าใจที่คุณหมายถึงแล้ว'], [4, 'ช่วยยกให้ฉันหน่อยได้ไหม'], [3, 'ตัวอย่างสั้น ๆ']]],
    ["It's good to see you. How has your day been?", 'ดีใจที่ได้เจอคุณ วันนี้เป็นอย่างไรบ้าง',
      'ประโยคหลังเป็นคำถามทักทายเกี่ยวกับวันที่ผ่านมา', [[5, 'ดีใจที่ได้เจอคุณ'], [5, 'วันนี้เป็นอย่างไรบ้าง']]],
    ["Let's practice for 5 minutes, then take a break.", 'มาฝึกกัน 5 นาที แล้วพักกัน', 'take a break หมายถึงพักสักหน่อย ให้จำเป็นกลุ่มคำ', [[3, 'มาฝึกกัน'], [2, '5 นาที'], [4, 'แล้วพักกัน']]],
    ['Listen first: This is a leaf. Now, say it at your own pace.', 'ฟังก่อนนะ นี่คือใบไม้หนึ่งใบ คราวนี้ลองพูดตามด้วยจังหวะที่คุณถนัด',
      'at your own pace คือทำตามความเร็วที่ตัวเองถนัด', [[2, 'ฟังก่อนนะ'], [4, 'นี่คือใบไม้หนึ่งใบ'], [3, 'คราวนี้ลองพูดตาม'], [4, 'ตามจังหวะที่คุณถนัด']]],
    ['Nice work! You remembered that word without a hint.', 'ทำได้ดี คุณจำคำนั้นได้โดยไม่ต้องดูคำใบ้',
      'without a hint หมายถึงทำได้โดยไม่ต้องใช้คำใบ้', [[2, 'ทำได้ดี'], [4, 'คุณจำคำนั้นได้'], [3, 'โดยไม่ต้องดูคำใบ้']]],
    ["No, I don't.", 'ไม่ ฉันไม่ชอบ', 'ในบทนี้ใช้ตอบคำถามว่าคุณชอบต้นไม้ไหม', [[3, 'ไม่ ฉันไม่ชอบ']]],
    ["Oh, look! There's a tiny flower beside the pot.", 'อ้อ ดูสิ มีดอกไม้เล็ก ๆ อยู่ข้างกระถาง',
      "There's ใช้บอกว่ามีบางสิ่งอยู่ตรงนั้น", [[2, 'อ้อ ดูสิ'], [4, 'มีดอกไม้เล็ก ๆ'], [3, 'อยู่ข้างกระถาง']]],
    ['One leaf. Two leaves. Can you hear the difference?', 'ใบไม้หนึ่งใบ ใบไม้สองใบ คุณได้ยินความแตกต่างไหม',
      'จำนวนมากกว่าหนึ่งใช้ leaves แทน leaf รูปคำและเสียงท้ายจึงเปลี่ยนไป', [[2, 'ใบไม้หนึ่งใบ'], [2, 'ใบไม้สองใบ'], [5, 'คุณได้ยินความแตกต่างไหม']]],
    ['Please help me.', 'ช่วยฉันหน่อย', 'ใช้ขอความช่วยเหลือได้เมื่อยังไม่เข้าใจ', [[3, 'ช่วยฉันหน่อย']]],
    ['Please say it again.', 'ช่วยพูดอีกครั้ง', 'again แปลว่าอีกครั้ง ใช้ขอฟังซ้ำได้', [[4, 'ช่วยพูดอีกครั้ง']]],
    ['Really? What do you like most about growing plants?', 'จริงเหรอ คุณชอบอะไรที่สุดเกี่ยวกับการปลูกต้นไม้',
      'like most หมายถึงชอบมากที่สุด', [[2, 'จริงเหรอ แล้วอะไร'], [4, 'ที่คุณชอบที่สุด'], [3, 'เกี่ยวกับการปลูกต้นไม้']]],
    ['Thank you!', 'ขอบคุณ', 'ใช้ขอบคุณเมื่อมีคนช่วยหรือให้บางสิ่ง', [[2, 'ขอบคุณ']]],
    ['Thank you.', 'ขอบคุณ', 'ใช้ขอบคุณเมื่อมีคนช่วยหรือให้บางสิ่ง', [[2, 'ขอบคุณ']]],
    ["That's okay. Take your time, and try again when you're ready.", 'ไม่เป็นไร ค่อย ๆ ทำได้ แล้วลองอีกครั้งเมื่อพร้อม',
      'Take your time. ใช้บอกว่าไม่ต้องรีบ ไม่ใช่คำสั่งให้จับเวลา', [[2, 'ไม่เป็นไร'], [3, 'ค่อย ๆ ทำได้'], [3, 'แล้วลองอีกครั้ง'], [3, 'เมื่อคุณพร้อม']]],
    ["The garden doesn't need to be perfect. We can notice one new thing, talk about it, and come back tomorrow.", 'สวนไม่จำเป็นต้องสมบูรณ์แบบ เราลองสังเกตสิ่งใหม่สักอย่าง คุยถึงสิ่งนั้น แล้วกลับมาอีกพรุ่งนี้ได้',
      "doesn't need to หมายถึงไม่จำเป็นต้อง ช่วยลดความกดดันว่าต้องทำให้สมบูรณ์แบบ", [[2, 'สวน'], [5, 'ไม่จำเป็นต้องสมบูรณ์แบบ'], [3, 'เราลองสังเกต'], [3, 'สิ่งใหม่สักอย่าง'], [3, 'คุยถึงสิ่งนั้น'], [4, 'แล้วกลับมาอีกพรุ่งนี้']]],
    ['The leaf is green.', 'ใบไม้มีสีเขียว', 'green บอกสีของใบไม้ คำว่า is เชื่อมสิ่งนั้นกับลักษณะของมัน', [[4, 'ใบไม้มีสีเขียว']]],
    ["The soil looks dry, but let's check it before we add any water.", 'ดินดูแห้ง แต่ลองตรวจดูก่อนเติมน้ำลงไป',
      'looks dry บอกว่าดูเหมือนแห้ง จึงควรตรวจจริงก่อนเติมน้ำ', [[4, 'ดินดูแห้ง'], [4, 'แต่ลองตรวจดูก่อน'], [5, 'ก่อนเติมน้ำลงไป']]],
    ['This is a leaf.', 'นี่คือใบไม้หนึ่งใบ', 'This is… ใช้บอกว่าสิ่งที่ชี้อยู่คืออะไร', [[4, 'นี่คือใบไม้หนึ่งใบ']]],
    ["This is a leaf. It's green and soft.", 'นี่คือใบไม้หนึ่งใบ มันมีสีเขียวและนุ่ม',
      "It's ในประโยคหลังหมายถึงใบไม้ที่เพิ่งพูดถึง", [[4, 'นี่คือใบไม้หนึ่งใบ'], [4, 'มันมีสีเขียวและนุ่ม']]],
    ['This is my plant.', 'นี่คือต้นไม้ของฉัน', 'my แปลว่าของฉัน วางหน้าสิ่งที่เป็นของเรา', [[4, 'นี่คือต้นไม้ของฉัน']]],
    ['This is…', 'นี่คือ…', 'พูด This is แล้วเติมชื่อสิ่งที่กำลังชี้ เช่น a leaf', [[2, 'นี่คือ…']]],
    ["Welcome back. Let's start with one small step.", 'ยินดีต้อนรับกลับมา มาเริ่มจากก้าวเล็ก ๆ หนึ่งก้าวกัน',
      'one small step ใช้เปรียบว่าค่อย ๆ เริ่มจากสิ่งเล็ก ๆ ก็ได้', [[2, 'ยินดีต้อนรับกลับมา'], [2, 'มาเริ่มกัน'], [4, 'จากก้าวเล็ก ๆ หนึ่งก้าว']]],
    ['What is this?', 'นี่คืออะไร', 'ใช้ถามชื่อของสิ่งที่อยู่ใกล้หรือกำลังชี้', [[3, 'นี่คืออะไร']]],
    ['What is this? This is a leaf.', 'นี่คืออะไร นี่คือใบไม้หนึ่งใบ', 'ฟังคำถามก่อน แล้วตอบชื่อสิ่งที่เห็นด้วย This is…', [[3, 'นี่คืออะไร'], [4, 'นี่คือใบไม้หนึ่งใบ']]],
    ['What would you like to practice today: plants, or talking with AI?', 'วันนี้คุณอยากฝึกเรื่องอะไร เรื่องต้นไม้ หรือการพูดคุยกับ AI',
      'would you like ใช้ถามความต้องการอย่างสุภาพ', [[4, 'คุณอยาก'], [3, 'ฝึกอะไรวันนี้'], [3, 'เรื่องต้นไม้ หรือการพูดคุย'], [2, 'กับ AI']]],
    ['Would you like to hear it again, or would you rather take a short break?', 'คุณอยากฟังอีกครั้ง หรืออยากพักสักครู่มากกว่า',
      'would you rather ใช้ถามว่าอยากเลือกอีกอย่างมากกว่าไหม', [[4, 'คุณอยาก'], [3, 'ฟังอีกครั้ง'], [4, 'หรือคุณอยาก'], [4, 'พักสักครู่มากกว่า']]],
    ['Write one sentence about a leaf.', 'เขียนหนึ่งประโยคเกี่ยวกับใบไม้', 'about ใช้บอกว่าประโยคนี้พูดถึงเรื่องอะไร', [[3, 'เขียนหนึ่งประโยค'], [3, 'เกี่ยวกับใบไม้']]],
    ['Write one sentence.', 'เขียนหนึ่งประโยค', 'one sentence คือหนึ่งประโยคที่สื่อความได้ครบ ไม่ใช่เพียงคำเดียว', [[3, 'เขียนหนึ่งประโยค']]],
    ['Yes, I do.', 'ใช่ ฉันชอบ', 'ในบทนี้ใช้ตอบรับคำถามว่าคุณชอบต้นไม้ไหม', [[3, 'ใช่ ฉันชอบ']]],
    ["You can say, Could you help me, please? Let's try that together.", 'คุณพูดได้ว่า ช่วยฉันหน่อยได้ไหม มาลองพูดแบบนั้นด้วยกัน',
      'Could you help me, please? เป็นประโยคขอความช่วยเหลืออย่างสุภาพ', [[3, 'คุณพูดได้ว่า'], [5, 'ช่วยฉันหน่อยได้ไหม'], [4, 'มาลองพูดแบบนั้นด้วยกัน']]],
    ["You don't have to get every word right. Let's try one sentence together.", 'คุณไม่จำเป็นต้องพูดถูกทุกคำ มาลองพูดหนึ่งประโยคด้วยกัน',
      "don't have to หมายถึงไม่จำเป็นต้อง ไม่ใช่ข้อห้ามว่าห้ามทำ", [[4, 'คุณไม่จำเป็นต้อง'], [4, 'พูดถูกทุกคำ'], [5, 'มาลองพูดหนึ่งประโยคด้วยกัน']]],
    ["You've learned three words today: leaf, root, and flower.", 'วันนี้คุณเรียนรู้คำสามคำแล้ว ได้แก่ ใบไม้ ราก และดอกไม้',
      'leaf, root และ flower เป็นชื่อส่วนต่าง ๆ ของต้นไม้', [[5, 'วันนี้คุณเรียนรู้คำสามคำแล้ว'], [4, 'ใบไม้ ราก และดอกไม้']]],
    ['about', 'เกี่ยวกับ', 'วางหน้าหัวข้อที่พูดถึง เช่น about a leaf คือเกี่ยวกับใบไม้'],
    ['again', 'อีกครั้ง', 'ใช้ขอทำหรือฟังซ้ำ เช่น say it again'],
    ['ask', 'ขอ; ถาม', 'ใน ask for help คำนี้หมายถึงขอความช่วยเหลือ'],
    ['green', 'สีเขียว', 'เป็นคำบอกสี เช่นใบไม้สีเขียว'],
    ['help', 'ช่วย; ความช่วยเหลือ', 'ใช้ขอให้ใครสักคนช่วยได้ เช่น Help me, please.'],
    ['leaf', 'ใบไม้หนึ่งใบ', 'ถ้ามีหลายใบจะเปลี่ยนรูปคำเป็น leaves'],
    ['like', 'ชอบ', 'ตามด้วยสิ่งที่ชอบ เช่น I like plants.'],
    ['my', 'ของฉัน', 'วางหน้าสิ่งที่เป็นของเรา เช่น my plant'],
    ['one', 'หนึ่ง', 'ใช้บอกจำนวนหนึ่งสิ่ง เช่น one leaf'],
    ['plant', 'พืช; ต้นไม้หนึ่งต้น', 'ในบทสวน คำนี้เป็นชื่อพืชหรือต้นไม้'],
    ['plants', 'พืช; ต้นไม้หลายต้น', 'ตัว s ท้ายคำช่วยบอกว่ามีมากกว่าหนึ่งต้น'],
    ['please', 'กรุณา; ช่วยให้คำขอสุภาพ', 'วางต้นหรือท้ายคำขอได้ เช่น Please help me.'],
    ['say', 'พูด', 'say it again หมายถึงพูดอีกครั้ง'],
    ['sentence', 'ประโยค', 'เป็นกลุ่มคำที่สื่อความได้ครบ เช่น This is a leaf.'],
    ['write', 'เขียน', 'ใช้บอกให้เขียน เช่น Write one sentence.']
  ];

  const keyFor = text => text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const LOOKUP = new Map(ENTRIES.map(entry => [keyFor(entry[0]), entry]));

  function forText(text) {
    if (typeof text !== 'string' || text.length > 2000) return null;
    const entry = LOOKUP.get(keyFor(text));
    if (!entry) return null;
    const source = text.trim();
    const matches = [...source.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*/g)];
    const [original, translation, tip, configuredChunks] = entry;
    const definitions = configuredChunks || [[matches.length, translation]];
    let cursor = 0;
    const chunks = definitions.map(([count, meaning]) => {
      const start = cursor;
      cursor += count;
      const endOffset = cursor < matches.length ? matches[cursor].index : source.length;
      return {text: source.slice(matches[start].index, endOffset).trim(), translation: meaning,
        wordIndices: Array.from({length: count}, (_, index) => start + index)};
    });
    if (cursor !== matches.length) throw new Error(`Study chunk coverage mismatch: ${original}`);
    const words = {};
    for (const match of matches) {
      const key = keyFor(match[0]);
      if (Object.hasOwn(WORD_MEANINGS, key)) words[key] = WORD_MEANINGS[key];
    }
    const key = keyFor(source);
    // A few high-frequency words change sense inside these particular phrases.
    if (/\blike to\b/.test(key)) words.like = 'อยาก';
    if (key.startsWith('i see what')) words.see = 'เข้าใจ';
    if (key.includes('this time')) words.time = 'ครั้งนี้';
    if (key.includes('could start')) words.could = 'อาจจะ';
    if (/take a (?:short )?break/.test(key)) words.take = 'พัก (ในวลี take a break)';
    if (key.includes('take your time')) words.take = 'ค่อย ๆ ใช้เวลา (ในวลี take your time)';
    if (key.includes("don't have to")) words.have = 'จำเป็นต้อง (ในวลี have to)';
    return {translation, tip, chunks, words};
  }

  return Object.freeze({forText});
});
