(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLGarden = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[x]));
  function render({completed = 0, interactive = false} = {}) {
    const growth = Math.max(0, Math.min(3, completed));
    return `<div class="garden-illustration" style="position:relative;max-width:560px;margin:auto">
      <svg viewBox="0 0 560 360" role="img" aria-label="สวนในเกม มีต้นไม้ ใบไม้ และผู้ช่วย AI">
        <rect x="10" y="10" width="540" height="340" rx="36" fill="#e8eee0"/>
        <circle cx="447" cy="80" r="33" fill="#e8ca81"/><path d="M35 280 Q130 235 245 268 T525 260 V330 H35Z" fill="#c9d8bf"/>
        <ellipse cx="263" cy="312" rx="112" ry="16" fill="#a7b99b" opacity=".5"/>
        <path d="M205 228H325L310 308Q266 323 222 308Z" fill="#c88767"/><rect x="197" y="221" width="136" height="26" rx="9" fill="#da9d78"/>
        <path d="M265 224 Q258 154 280 80 M263 186L212 150 M268 158L318 119" fill="none" stroke="#436e4d" stroke-width="8" stroke-linecap="round"/>
        <path d="M267 185Q196 198 191 128Q251 126 267 185Z" fill="#4b8357"/>
        <path d="M273 159Q285 93 344 100Q337 158 273 159Z" fill="#31664b"/>
        <path d="M280 110Q258 58 310 43Q335 91 280 110Z" fill="#71925c"/>
        ${growth >= 1 ? '<path d="M264 217Q205 237 206 184Q248 179 264 217Z" fill="#70995c"/>' : ''}
        ${growth >= 2 ? '<path d="M266 201Q299 166 332 187Q320 225 266 201Z" fill="#82a665"/>' : ''}
        ${growth >= 3 ? '<g fill="#d4ad5e"><circle cx="137" cy="235" r="9"/><circle cx="137" cy="217" r="8"/><circle cx="122" cy="225" r="8"/><circle cx="151" cy="225" r="8"/></g><path d="M137 239V287" stroke="#658253" stroke-width="4"/>' : ''}
        <path d="M390 235h64v49h-64z" fill="#f8faf4" stroke="#819883" stroke-width="2"/><rect x="381" y="225" width="81" height="50" rx="16" fill="#fffef7" stroke="#819883" stroke-width="2"/>
        <circle cx="405" cy="248" r="5" fill="#3b694d"/><circle cx="439" cy="248" r="5" fill="#3b694d"/><path d="M414 260q9 7 17 0" stroke="#3b694d" stroke-width="2" fill="none"/>
        <path d="M421 225V212" stroke="#819883" stroke-width="3"/><circle cx="421" cy="208" r="5" fill="#d4ad5e"/>
        <path d="M78 303V268M92 302V278M65 304V281" stroke="#7c9c65" stroke-width="5" stroke-linecap="round"/>
      </svg>
      ${interactive ? '<div class="garden-hotspots"><button class="button secondary" style="position:absolute;left:23%;top:29%;font-size:13px" data-action="word" data-word="leaf" aria-label="เรียนคำว่า leaf ใบไม้">leaf</button><button class="button secondary" style="position:absolute;left:39%;top:69%;font-size:13px" data-action="word" data-word="plant" aria-label="เรียนคำว่า plant ต้นไม้">plant</button><button class="button secondary" style="position:absolute;left:68%;top:43%;font-size:13px" data-action="word" data-word="help" aria-label="เรียนคำว่า help ช่วย">help</button></div>' : ''}
      <p class="small muted" style="text-align:center;margin:0">สวนในเกมเติบโตตามภารกิจที่ทำครบ ${esc(growth)}/3 บท</p>
    </div>`;
  }
  return {render};
});
