/** INVAL FREE v1.5 - no remote APIs, no storage and no uploads. */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const BASE = '/otmena-prikaza/';
const MAX_FILE = 15 * 1024 * 1024;
let activeStep = 1;
let detectedType = 'unknown';
let recognizedText = '';
let busy = false;
const values = ['court','case','order-date','debtor','address','claimant','received-date','learned-date','reason','proof'];

const trim = (v) => String(v || '').trim().replace(/\r/g, '').replace(/[\t ]+/g, ' ');
const value = (id) => trim($('#' + id)?.value);
const show = (el, visible) => {el.hidden = !visible;};
const todayISO = () => {const d = new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
function dateRU(iso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return '';const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`; }
function validDate(iso) {if (!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return false;const [y,m,d]=iso.split('-').map(Number), a=new Date(Date.UTC(y,m-1,d));return a.getUTCFullYear()===y && a.getUTCMonth()===m-1 && a.getUTCDate()===d;}
function dayDiff(a,b) {const iso=(s)=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d);};return Math.floor((iso(b)-iso(a))/86400000);}
function alertMessage(text, variant='error') {const b=$('#error-box'), n=$('#notice-box');show(b,false);show(n,false);const target=variant==='error'?b:n;target.textContent=text;show(target,true);target.scrollIntoView({behavior:'smooth',block:'nearest'});}
function clearMessage(){show($('#error-box'),false);show($('#notice-box'),false);}
function setStep(step) {activeStep=step;clearMessage();$$('[data-panel]').forEach(p=>show(p,+p.dataset.panel===step));$$('[data-step-indicator]').forEach(el=>{const n=+el.dataset.stepIndicator;el.classList.toggle('active',n===step);el.classList.toggle('done',n<step);});window.scrollTo({top:0,behavior:'smooth'});}
function status(title,detail) {$('#recognition-title').textContent=title;$('#recognition-detail').textContent=detail;show($('#recognition-status'),true);}
function setKind(text) {
  if (/(?:КАС\s*РФ|Кодекса\s+административного\s+судопроизводства|123\.5\s*КАС|123\.7\s*КАС)/i.test(text) || /административн[а-яё]*\s+судебн[а-яё]*\s+приказ/i.test(text)) return 'kas';
  if (/(?:АПК\s*РФ|229\.5\s*АПК|арбитражн[а-яё]*\s+суд)/i.test(text)) return 'apk';
  if (/(?:судебн[а-яё]*\s+приказ|приказн[а-яё]*\s+производств)/i.test(text)) return 'order';
  if (/(?:решение\s+суда|заочн[а-яё]*\s+решение|апелляционн[а-яё]*\s+определение)/i.test(text)) return 'not-order';
  return 'unknown';
}
function updateKind() {
  detectedType=setKind(recognizedText);
  const el=$('#document-kind');
  const descriptions={kas:'Распознан документ по КАС РФ — этот генератор не подходит.',apk:'Похоже на арбитражное производство (АПК РФ) — этот генератор не подходит.',order:'Похоже на судебный приказ. Обязательно проверьте вид производства.', 'not-order':'Похоже на судебное решение, а не на судебный приказ. Генератор не подходит.',unknown:'Тип документа не определён автоматически. Проверьте вручную.'};
  el.textContent=descriptions[detectedType];el.classList.toggle('bad',['kas','apk','not-order'].includes(detectedType));
}
function cleanMatch(s) {return trim((s||'').replace(/^[\s:№#—-]+/,'')).replace(/[;,\s]+$/,'').slice(0,250);}
/* INVAL v1.2: cautious parsing of judicial-order fields; never infer missing data. */
/* INVAL v1.2: cautious parsing of judicial-order fields; never infer missing data. */
/* INVAL v1.4: conservative party extraction from the operative part, without inferring absent data. */
function normalizeDocumentText(text) {
  return String(text || '')
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    .replace(/[\u200b\u00ad]/g, '')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n');
}
function extractDocumentDate(s) {
  const months = {января:1,февраля:2,марта:3,апреля:4,мая:5,июня:6,июля:7,августа:8,сентября:9,октября:10,ноября:11,декабря:12};
  const str = String(s || '');
  const re = /(?:^|[^\d])([0-3]?\d)\s*[./-]\s*([01]?\d)\s*[./-]\s*(20\d{2})(?!\d)/g;
  for (const m of str.matchAll(re)) {
    const iso = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    if (validDate(iso)) return iso;
  }
  const m = str.match(/[«"']?([0-3]?\d)[»"']?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(20\d{2})/i);
  if (m) {
    const iso = `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    if (validDate(iso)) return iso;
  }
  return '';
}
function parseFields(text) {
  const s = normalizeDocumentText(text);
  const lines = s.split(/\n+/).map(x => trim(x)).filter(Boolean);
  const flat = s.replace(/\s+/g,' ');
  const found = {};
  const stopFields = /\s+(?=(?:должник|взыскатель|заявитель|адрес\s+(?:должника|регистрации|взыскателя)|инн|огрн|кпп|дело|материал|судебный\s+приказ|установил|постановил|рассмотрев|паспорт|телефон|дата\s+рождения|место\s+рождения)(?=$|[\s:№.,;\-])\s*(?::|№|\-|\s))/i;
  const truncateField = (v) => cleanMatch(String(v || '').split(stopFields)[0].replace(/[;,\s]+$/,'')).slice(0,180);

  // Use only the precinct number; never include a judge's name or a postal address.
  // Ambiguous precincts and case numbers require manual verification.
  const courtPrefix = /(?:(?:\u043c\u0438\u0440\u043e\u0432(?:\u043e\u0439|\u043e\u043c\u0443|\u043e\u0433\u043e)\s+\u0441\u0443\u0434\u044c[\u0435\u044f]\s+))?(?:\u0441\u0443\u0434\u0435\u0431\u043d(?:\u043e\u0433\u043e|\u044b\u0439|\u043e\u043c\u0443)\s+\u0443\u0447\u0430\u0441\u0442(?:\u043a\u0430|\u043e\u043a|\u043a\u0443))\s*(?:\u2116|N(?:o)?\.?|#)?\s*(\d{1,5})(?!\d)/giu;
  const precincts = new Set([...flat.matchAll(courtPrefix)].map(x=>String(Number(x[1]))));
  if (precincts.size===1) found.court='\u041c\u0438\u0440\u043e\u0432\u043e\u043c\u0443 \u0441\u0443\u0434\u044c\u0435 \u0441\u0443\u0434\u0435\u0431\u043d\u043e\u0433\u043e \u0443\u0447\u0430\u0441\u0442\u043a\u0430 \u2116 '+[...precincts][0];

  // OCR can add spaces in a number or confuse Cyrillic/Latin O with digit 0.
  // Do not guess when the text contains different case numbers.
  const numericText=flat.replace(/(?<=\d)[O\u041e\u043e](?=\d)/g,'0');
  const caseExpr=/(?:^|[^\d])(2\s*[-\u2010\u2011\u2012\u2013\u2014\u2212]\s*\d(?:\s*\d){0,8}\s*\/\s*20\d{2}(?:\s*[-/]\s*\d{1,4})?)(?!\d)/giu;
  const caseNumbers=new Set([...numericText.matchAll(caseExpr)].map(m=>m[1].replace(/\s+/g,'').replace(/[-\u2010\u2011\u2012\u2013\u2014\u2212]/g,'-')));
  if (caseNumbers.size===1) found.case=[...caseNumbers][0];

  // Use only nominative FIO directly following a party label.
  // Names in "взыскать с ..." have different grammatical case and are not safe to auto-convert.
  const fioExpr = /^([А-ЯЁ][а-яёА-ЯЁ-]{1,43}\s+[А-ЯЁ][а-яёА-ЯЁ-]{1,43}\s+[А-ЯЁ][а-яёА-ЯЁ-]{1,43})(?=$|[\s,;:.])/u;
  const invalidFio = /(?:^|[^\p{L}])(?:судебного|приказа|документов|город|судья|участка|района|суда|адрес|российской|федерации|общество|ограниченной|ответственностью)(?=$|[^\p{L}])/iu;
  const roleChunks = (role) => {
    const starts = role==='debtor' ? [
      /(?:^|[\s;])должник(?:\s*\([^)]{0,35}\))?\s*(?:[:\-]\s*|\s+)([^;]{1,165})/gi,
      /(?:^|[\s;])ф\.?\s*и\.?\s*о\.?\s+должника\s*[:\-]\s*([^;]{1,165})/gi
    ] : [
      /(?:^|[\s;])(?:взыскатель|заявитель)\s*(?:[:\-]\s*|\s+)([^;]{1,185})/gi,
      /(?:^|[\s;])наименование\s+взыскателя\s*[:\-]\s*([^;]{1,185})/gi
    ];
    const chunks=[];
    for (const re of starts) for(const m of flat.matchAll(re)) chunks.push(truncateField(m[1]));
    return chunks;
  };
  for (const chunk of roleChunks('debtor')) {
    const m = chunk.match(fioExpr);
    if (m && !invalidFio.test(m[1])) {found.debtor = cleanMatch(m[1]);break;}
  }

  const orgHead = /^(?:ООО|ПАО|АО|ОАО|ЗАО|НАО|ИП|КПКГ?|ПКО|МКК|МФК|КПК|общество\s+с\s+ограниченной\s+ответственностью|публичное\s+акционерное\s+общество|кредитный\s+потребительский\s+кооператив|коллекторский\s+потребительский\s+кооператив)(?=$|[\s.,;:])/i;
  const genericOrganization = /^(?:коллекторский|кредитный)\s+потребительский\s+кооператив$/i;
  function organizationFrom(chunk) {
    if (!orgHead.test(chunk) || genericOrganization.test(chunk)) return '';
    let candidate = chunk
      .split(/\s*,\s*(?=(?:ИНН|ОГРН|КПП|адрес|телефон|место\s+нахождения)\b)/i)[0]
      .split(/\s+(?=(?:ИНН|ОГРН|КПП|адрес|телефон)\b)\s*[:№]?/i)[0];
    const quoted = candidate.match(/^(.*?)\s*([«"][^»"]{2,100}[»"])/);
    if (quoted && orgHead.test(quoted[1].trim())) candidate=quoted[1].trim()+' '+quoted[2];
    candidate = truncateField(candidate);
    if (!orgHead.test(candidate) || genericOrganization.test(candidate)) return '';
    if (candidate.length < 7 || candidate.length>145) return '';
    // A bare legal form is not a complete creditor name.
    if (/^(?:ООО|ПАО|АО|ОАО|ЗАО|НАО|ИП|КПКГ?|ПКО|МКК|МФК)$/i.test(candidate)) return '';
    if (/(?:судебный\s+приказ|рассмотрев|должник|взыскать|дело)(?=$|[\s.,;:])/i.test(candidate)) return '';
    return candidate;
  }
  // Prefer the creditor actually named in the application, not a later
  // boilerplate use of the word "взыскатель". Take only a complete quoted
  // legal entity immediately after an unequivocal relationship marker.
  const orgInContext = /^\s*((?:(?:ООО|ПАО|АО|ОАО|ЗАО|НАО|КПК|ПКО|МКК|МФК|КПКГ?)\s+)[«"][^»"]{2,100}[»"])/i;
  const strongClaimantLead = /(?:по\s+)?заявлени[еяю]\s+(?:взыскателя\s+)?|(?:взыскатель|заявитель)\s*[:\-]\s*|в\s+пользу\s+/gi;
  const strongClaimants=[];
  for (const lead of flat.matchAll(strongClaimantLead)) {
    const after=flat.slice(lead.index+lead[0].length,lead.index+lead[0].length+150);
    const match=after.match(orgInContext);
    if (!match) continue;
    const org=organizationFrom(match[1]);
    if (org) strongClaimants.push(org);
  }
  const differentClaimants=[...new Set(strongClaimants.map(x=>x.toLocaleLowerCase('ru-RU')))];
  if (differentClaimants.length===1) {
    found.claimant=strongClaimants[0];
  } else if (differentClaimants.length>1) {
    // Different organizations in strong creditor positions: leave empty for
    // a human to resolve, rather than silently choose one.
    found.claimant='';
  }
  if (!found.claimant && differentClaimants.length===0) for (const chunk of roleChunks('claimant')) {
    const org=organizationFrom(chunk);
    const person=chunk.match(fioExpr);
    if (org) { found.claimant=org; break; }
    if (person && !invalidFio.test(person[1])) { found.claimant=cleanMatch(person[1]); break; }
  }
  if (!found.claimant && differentClaimants.length===0) {
    // When there is no labeled creditor, a quoted company immediately after
    // "по заявлению" is sufficiently unambiguous to propose for review.
    for(const m of flat.matchAll(/по\s+заявлению\s+((?:(?:ООО|ПАО|АО|ОАО|ЗАО|НАО|КПК|ПКО|МКК|МФК)\s+|(?:коллекторский|кредитный)\s+потребительский\s+кооператив\s+)[«"][^»"]{2,100}[»"])/gi)) {
      const org=organizationFrom(m[1]);
      if(org){found.claimant=org;break;}
    }
  }

  if (!found.claimant && differentClaimants.length===0) {
    for(const m of flat.matchAll(/в\s+пользу\s+((?:ООО|ПАО|АО|ОАО|ЗАО|НАО|КПК|ПКО|МКК|МФК)\s+[«"][^»"]{2,100}[»"])/gi)) {
      const org=organizationFrom(m[1]);
      if(org){found.claimant=org;break;}
    }
  }

  // Prefer dates explicitly attached to the judicial order rather than
  // arbitrary dates elsewhere in the debtor's case.
  const explicitRE = /(?:судебн[а-яё]*\s+приказ[а-яё]*\s+(?:№\s*[^\s,;]{1,25}\s+)?от\s*|дата\s+(?:вынесения|выдачи)\s+(?:судебного\s+)?приказа\s*[:\-]\s*)([^,;]{4,55})/gi;
  for(const m of flat.matchAll(explicitRE)) {
    const date=extractDocumentDate(m[1]);
    if(date){found['order-date']=date;break;}
  }
  if (!found['order-date']) {
    for(let i=0;i<lines.length;i++) {
      if (!/судебн[а-яё]*\s+приказ[а-яё]*/i.test(lines[i])) continue;
      // Title, previous line and next two lines. Ambiguous dates stay empty.
      const region=lines.slice(Math.max(0,i-1),Math.min(lines.length,i+3)).join(' ');
      const dates=new Set();
      const re = /[«"']?[0-3]?\d[»"']?\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+20\d{2}|\b[0-3]?\d\s*[./-]\s*[01]?\d\s*[./-]\s*20\d{2}\b/gi;
      for(const match of region.matchAll(re)) {const d=extractDocumentDate(match[0]);if(d)dates.add(d);}
      if(dates.size===1)found['order-date']=[...dates][0];
      break;
    }
  }
  return found;
}

/** High-signal evidence fragments only. No network calls; textContent prevents HTML injection. */
function renderLocalHints(text) {
  const details=$('#local-hints'), root=$('#local-hint-list');
  if (!details || !root) return;
  root.replaceChildren();
  if (!text || !text.trim()) {show(details,false);return;}
  const flat=normalizeDocumentText(text).replace(/\s+/g,' ').slice(0,40000);
  const groups=[
    {label:'\u041d\u043e\u043c\u0435\u0440 \u0434\u0435\u043b\u0430 (\u0441\u0432\u0435\u0440\u044c\u0442\u0435)', limit:2, patterns:[
      /2\s*[-\u2010\u2011\u2012\u2013\u2014\u2212]\s*\d(?:\s*\d){0,8}\s*\/\s*20\d{2}/gi
    ]},
    {label:'\u0414\u0430\u0442\u0430 \u0432 \u0442\u0435\u043a\u0441\u0442\u0435 (\u0441\u0432\u0435\u0440\u044c\u0442\u0435)', limit:2, patterns:[
      /[0-3]?\d\s*[./-]\s*[01]?\d\s*[./-]\s*20\d{2}/gi,
      /[0-3]?\d\s+(?:\u044f\u043d\u0432\u0430\u0440\u044f|\u0444\u0435\u0432\u0440\u0430\u043b\u044f|\u043c\u0430\u0440\u0442\u0430|\u0430\u043f\u0440\u0435\u043b\u044f|\u043c\u0430\u044f|\u0438\u044e\u043d\u044f|\u0438\u044e\u043b\u044f|\u0430\u0432\u0433\u0443\u0441\u0442\u0430|\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f|\u043e\u043a\u0442\u044f\u0431\u0440\u044f|\u043d\u043e\u044f\u0431\u0440\u044f|\u0434\u0435\u043a\u0430\u0431\u0440\u044f)\s+20\d{2}/gi
    ]},
    {label:'Суд', limit:2, patterns:[
      /судебн[а-яё]*\s+участ[а-яё]*\s*(?:№|N)?\s*\d{1,5}/gi,
      /миров[а-яё]*\s+суд[а-яё]*/gi
    ]},
    {label:'Должник (сверьте падеж ФИО)', limit:3, patterns:[
      /(?:взыскать|взыскании)\s+с\s+(?:должника\s+|гражданина\s+)?/gi,
      /(?:^|[\s,;:.])с\s+должника\s+/gi,
      /(?:^|[\s,;:.])должник\s*[:\-]\s*/gi,
      /(?:^|[\s,;:.])должника\s+(?=[А-ЯЁ][а-яё]+)/g,
      /(?:ф\.?\s*и\.?\s*о\.?)\s+должника\s*[:\-]?\s*/gi
    ]},
    {label:'Взыскатель (проверьте полное название)', limit:3, patterns:[
      /(?:по\s+)?заявлени[еяю]\s+взыскателя\s+/gi,
      /(?:по\s+)?заявлени[еяю]\s+(?=(?:ООО|ПАО|АО|ОАО|ЗАО|МКК|МФК|КПК|ПКО)\s)/gi,
      /(?:^|[\s,;:.])взыскатель\s*[:\-]\s*/gi,
      /(?:^|[\s,;:.])в\s+пользу\s+(?=(?:ООО|ПАО|АО|ОАО|ЗАО|МКК|МФК|КПК|ПКО)\s)/gi
    ]}
  ];
  for (const group of groups) {
    const candidates=[];
    for (let priority=0;priority<group.patterns.length;priority++) {
      const pattern=group.patterns[priority];
      for (const m of flat.matchAll(pattern)) {
        // Show the context around the evidence, not first occurrences of a
        // generic word in procedural instructions.
        const start=Math.max(0,m.index-25);
        const excerpt=flat.slice(start,Math.min(flat.length,m.index+(group.label==='Суд'?135:205))).trim();
        if(excerpt.length<17)continue;
        if(candidates.some(c=>Math.abs(c.index-m.index)<65))continue;
        candidates.push({index:m.index,priority,excerpt});
      }
    }
    candidates.sort((a,b)=>a.priority-b.priority||a.index-b.index);
    for(const candidate of candidates.slice(0,group.limit)) {
      const p=document.createElement('p');p.className='small-note';
      const strong=document.createElement('strong');strong.textContent=group.label+': ';
      const content=document.createElement('span');content.textContent=candidate.excerpt;
      p.append(strong,content);root.append(p);
    }
  }
  show(details,root.childElementCount>0);
}
function fillFromText(text) {const found=parseFields(text);let count=0;for(const [id,v] of Object.entries(found)){const el=$('#'+id);if(el && !el.value){el.value=v;count++;}}return count;}
async function fetchFile(url) {const resp=await fetch(url,{cache:'force-cache',credentials:'same-origin'});if(!resp.ok)throw Error('Локальный ресурс недоступен: '+url);return resp;}
async function loadScript(url){if(window.Tesseract)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(new Error('Не удалось загрузить локальный модуль распознавания.'));document.head.appendChild(s);});if(!window.Tesseract)throw Error('Библиотека распознавания не загрузилась.');}
let ocrWorker = null;
async function getOCR(){if(ocrWorker)return ocrWorker;await loadScript(BASE+'vendor/tesseract/tesseract.min.js');status('Подготовка распознавания','Загружаем локальные языковые модели. При первом запуске это может занять время.');ocrWorker=await window.Tesseract.createWorker('rus+eng',1,{
  workerPath:BASE+'vendor/tesseract/worker.min.js',
  corePath:BASE+'vendor/tesseract-core',
  langPath:BASE+'vendor/lang',
  workerBlobURL:false,
  logger:(m)=>{if(typeof m.progress==='number')$('#recognition-detail').textContent=`${m.status||'Распознавание'} · ${Math.round(m.progress*100)}%`;},
});return ocrWorker;}
async function recognizeImage(blob){const ocr=await getOCR();const response=await ocr.recognize(blob);return response.data.text||'';}
function pdfTextLines(content) {
  const items = (content.items || []).filter(x => typeof x.str === 'string' && x.str.trim());
  const havePositions = items.length > 0 && items.every(x => Array.isArray(x.transform) && x.transform.length >= 6);
  if (!havePositions) return items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('');
  const groups = [];
  for (const item of items) {
    const y = Number(item.transform[5]), x = Number(item.transform[4]);
    if (!Number.isFinite(y) || !Number.isFinite(x)) continue;
    let group = groups.find(g => Math.abs(g.y - y) < 2.5);
    if (!group) { group = {y, parts:[]}; groups.push(group); }
    group.parts.push({x, s:item.str});
  }
  if (groups.length === 0) return items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('');
  return groups.sort((a,b)=>b.y-a.y)
    .map(g => g.parts.sort((a,b)=>a.x-b.x).map(x=>x.s).join(' ')).join('\n');
}
function textQuality(s) {
  const text = String(s || '');
  const cyr = (text.match(/[а-яё]/gi)||[]).length;
  const markers = ['судебн','приказ','суд','дело','должник','взыскател','миров','участ'];
  let anchors = 0;
  for (const marker of markers) if (text.toLowerCase().includes(marker)) anchors++;
  return {cyr, anchors, score:Math.min(cyr,300)/20 + anchors*7};
}
async function extractPDF(file) {
  status('Читаем PDF','Обрабатываем страницы в памяти браузера.');
  const pdfjs = await import(BASE+'vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=BASE+'vendor/pdfjs/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
  try {
    if(doc.numPages > 12) throw Error('В документе более 12 страниц. Выберите страницы судебного приказа или заполните сведения вручную.');
    const pages = [];
    for(let n=1;n<=doc.numPages;n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        const nativeText = pdfTextLines(content).trim();
        const quality = textQuality(nativeText);
        // A PDF can have a long but broken text layer; try OCR if it lacks recognizable words.
        if (quality.cyr >= 110 && quality.anchors >= 3 && Object.keys(parseFields(nativeText)).length >= 3) {
          pages.push(nativeText);
          continue;
        }
        status('Распознаём страницу PDF',`Страница ${n} из ${doc.numPages}. Все вычисления выполняются на вашем устройстве.`);
        let recognized = '';
        const baseViewport=page.getViewport({scale:1});
        const scale = Math.min(3.2, Math.max(1,2000/baseViewport.width));
        const viewport=page.getViewport({scale});
        const canvas=document.createElement('canvas');
        try {
          canvas.width=Math.floor(viewport.width);
          canvas.height=Math.floor(viewport.height);
          const ctx=canvas.getContext('2d',{willReadFrequently:true});
          if(!ctx)throw Error('Не удалось создать графический контекст.');
          await page.render({canvasContext:ctx,viewport}).promise;
          const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось подготовить изображение.')),'image/png'));
          recognized=await recognizeImage(blob);
        } catch (error) {
          if(!nativeText.trim())throw error;
          status('Текст PDF извлечён',`OCR страницы ${n} недоступен; используем текстовый слой. Проверьте реквизиты.`);
        } finally {
          canvas.width=0;canvas.height=0;
        }
        // Keep native text AND OCR when OCR contributes missing evidence.
        // For the same field, the native text appears first unless demonstrably worse.
        const nativeFields=parseFields(nativeText);
        const ocrFields=parseFields(recognized);
        const additional=Object.keys(ocrFields).some(k=>!nativeFields[k]);
        if(!recognized) pages.push(nativeText);
        else if(!nativeText) pages.push(recognized);
        else if(additional) {
          const ocrBetter=textQuality(recognized).score > textQuality(nativeText).score*1.3;
          pages.push((ocrBetter?recognized:nativeText) + '\n' + (ocrBetter?nativeText:recognized));
        } else pages.push(textQuality(recognized).score>textQuality(nativeText).score*1.3?recognized:nativeText);
      } finally {page.cleanup();}
    }
    return pages.join('\n');
  } finally {await doc.destroy();}
}
function clearPreviousCase() {
  for (const id of values) { const el=$('#'+id); if(el)el.value=''; }
  $('#confirm-gpk').checked=false;
  $('#confirm-proof').checked=false;
  $('input[name=route][value=normal]').checked=true;
  $('#raw-text').value='';
  recognizedText='';detectedType='unknown';
  show($('#recognized-info'),false);renderLocalHints('');
  $('#preview').replaceChildren();$('#print-sheet').replaceChildren();
  updateRoute();
}
async function readDocument(file){if(busy)return;if(!file)return;if(file.size>MAX_FILE){alertMessage('Файл больше 15 МБ. Уменьшите его или заполните данные вручную.');return;}
  const extension=file.name.toLowerCase().split('.').pop();const validPDF=file.type==='application/pdf'||extension==='pdf';const validImage=['png','jpeg','jpg','webp'].includes(extension)||['image/png','image/jpeg','image/webp'].includes(file.type);
  if(!validPDF&&!validImage){alertMessage('Поддерживаются только PDF, PNG, JPEG и WEBP.');return;}
  // Never mix fields from different case files during repeated tests.
  if(recognizedText || values.some(id=>value(id))){
    if(!window.confirm('Это другой приказ? Сведения предыдущего дела будут очищены перед обработкой нового документа.')) return;
    clearPreviousCase();
  }
  busy=true;clearMessage();status('Открываем файл',file.name.slice(0,80));
  try {const text=validPDF?await extractPDF(file):await recognizeImage(file);recognizedText=(text||'').slice(0,40000);if(!recognizedText.trim())throw Error('Не удалось прочитать текст. Введите реквизиты вручную.');$('#raw-text').value=recognizedText;show($('#recognized-info'),true);updateKind();const count=fillFromText(recognizedText);renderLocalHints(recognizedText);
    const labels={court:'суд',case:'номер дела','order-date':'дату приказа',debtor:'ФИО должника',claimant:'взыскателя'};
    const missing=Object.entries(labels).filter(([k])=>!value(k)).map(([,v])=>v);
    show($('#recognition-status'),false);
    alertMessage(`Текст считан на устройстве (${recognizedText.length} символов). Заполнено автоматически: ${count}. ${missing.length?'Проверьте и заполните вручную: '+missing.join(', ')+'. ':''}Адрес для корреспонденции укажите самостоятельно. Любые заполненные поля обязательно сверьте с оригиналом.`, 'notice');
  }catch(err){show($('#recognition-status'),false);show($('#recognized-info'),false);recognizedText='';detectedType='unknown';alertMessage(`${err.message||'Ошибка распознавания'}. Можно продолжить и заполнить реквизиты вручную.`);}
  finally{busy=false;}
}
function validateFields(){
  const court=value('court');
  if(/^\u043c\u0438\u0440\u043e\u0432\u043e\u043c\u0443\s+\u0441\u0443\u0434\u044c\u0435\s+\u0441\u0443\u0434\u0435\u0431\u043d\u043e\u0433\u043e\s+\u0443\u0447\u0430\u0441\u0442\u043a\u0430\s*\u2116?\s*\d{1,5}\.?$/iu.test(court)){
    alertMessage('\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043f\u043e\u043b\u043d\u043e\u0435 \u043d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435 \u0441\u0443\u0434\u0435\u0431\u043d\u043e\u0433\u043e \u0443\u0447\u0430\u0441\u0442\u043a\u0430 \u0438 \u0440\u0435\u0433\u0438\u043e\u043d \u043f\u043e \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u0443. \u041e\u0434\u043d\u043e\u0433\u043e \u043d\u043e\u043c\u0435\u0440\u0430 \u0443\u0447\u0430\u0441\u0442\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e.');
    $('#court').focus();return false;
  }
  for(const id of ['court','case','order-date','debtor','address','claimant']){if(!value(id)){alertMessage('Заполните все обязательные реквизиты. Неизвестные сведения нельзя подставлять наугад.');$('#'+id).focus();return false;}}
  if(!validDate(value('order-date'))||value('order-date')>todayISO()){alertMessage('Проверьте дату вынесения приказа.');$('#order-date').focus();return false;}
  if(['kas','apk','not-order'].includes(detectedType)){alertMessage('В загруженном документе обнаружены признаки другого вида судебного производства. Генератор по ГПК РФ применять нельзя.');return false;}
  if(!$('#confirm-gpk').checked){alertMessage('Подтвердите, что сверили данные и это судебный приказ именно по ГПК РФ.');return false;}
  return true;
}
function route(){return $('input[name=route]:checked')?.value||'normal';}
function updateRoute(){const late=route()==='late';show($('#normal-fields'),!late);show($('#late-fields'),late);clearMessage();}
function updateTermNote(){const received=value('received-date');const note=$('#term-note');if(!validDate(received)){note.textContent='Укажите фактическую дату получения. День вынесения приказа не считается датой вручения.';return;}
  const days=dayDiff(received,todayISO());
  if(days<0)note.textContent='Дата получения указана в будущем. Исправьте её.';
  else if(days>10)note.textContent=`С даты получения прошло ${days} календарных дней. Это не расчёт процессуального срока: по ст. 107 ГПК РФ нерабочие дни не включаются. Проверьте сроки и обстоятельства вручения.`;
  else note.textContent=`С указанной даты прошло ${days} календарных дней. Это лишь предварительная оценка: срок рассчитывается по процессуальным правилам, и суд проверяет обстоятельства вручения.`;
}
function validateRoute(){if(route()==='normal'){
  const rec=value('received-date');if(!validDate(rec)){alertMessage('Укажите дату фактического получения копии приказа.');$('#received-date').focus();return false;}
  if(dayDiff(rec,todayISO())<0){alertMessage('Дата получения не может быть в будущем.');return false;}
  if(dayDiff(rec,todayISO())>10&&!window.confirm('С даты получения прошло более 10 календарных дней. По ст. 107 ГПК РФ нерабочие дни не включаются. Вы самостоятельно проверили процессуальный срок и уверены, что он не пропущен? Нажмите «Отмена», чтобы проверить обстоятельства.'))return false;
}else{
  if(value('learned-date') && (!validDate(value('learned-date'))||value('learned-date')>todayISO())){alertMessage('Проверьте дату, когда узнали о приказе.');return false;}
  if(value('reason').length<25){alertMessage('Подробно изложите реальные обстоятельства пропуска срока (не менее 25 символов).');$('#reason').focus();return false;}
  if(value('proof').length<5){alertMessage('Перечислите документы, подтверждающие причины пропуска срока.');$('#proof').focus();return false;}
  if(!$('#confirm-proof').checked){alertMessage('Подтвердите достоверность обстоятельств и наличие доказательств.');return false;}
}return true;}
function buildDocument(){const d={court:value('court'),case:value('case'),date:dateRU(value('order-date')),debtor:value('debtor'),address:value('address'),claimant:value('claimant'),received:dateRU(value('received-date')),learned:dateRU(value('learned-date')),reason:value('reason'),proof:value('proof'),isLate:route()==='late',created:dateRU(todayISO())};
  const para=(text,style='indent')=>({text,style});
  const parts=[
    para(d.court,'right'),
    para(`Должник: ${d.debtor}\nАдрес для корреспонденции: ${d.address}\nВзыскатель: ${d.claimant}\nДело № ${d.case}`,'right'),
    para(d.isLate?'ВОЗРАЖЕНИЯ ОТНОСИТЕЛЬНО ИСПОЛНЕНИЯ СУДЕБНОГО ПРИКАЗА И ХОДАТАЙСТВО О ВОССТАНОВЛЕНИИ СРОКА':'ВОЗРАЖЕНИЯ ОТНОСИТЕЛЬНО ИСПОЛНЕНИЯ СУДЕБНОГО ПРИКАЗА','title'),
    para(`Судом, указанным выше, вынесен судебный приказ от ${d.date} по делу № ${d.case} по заявлению взыскателя ${d.claimant}.`),
    para('С вынесенным судебным приказом не согласен(на), возражаю относительно его исполнения.'),
  ];
  if(d.isLate){
    parts.push(para(d.learned?`О существовании судебного приказа я узнал(а) ${d.learned}.`:'Обстоятельства получения информации о судебном приказе изложены ниже.'));
    parts.push(para(`Обстоятельства, по которым возражения не были представлены в установленный срок: ${d.reason}`));
    parts.push(para(`В подтверждение обстоятельств прилагаю: ${d.proof}`));
    parts.push(para('На основании статей 112, 128 и 129 ГПК РФ прошу суд:'));
    parts.push(para('1. Восстановить срок для представления возражений относительно исполнения судебного приказа от '+d.date+' по делу № '+d.case+'.','normal'));
    parts.push(para('2. Принять настоящие возражения и отменить указанный судебный приказ.','normal'));
    parts.push(para('3. Направить мне копию определения об отмене судебного приказа.','normal'));
    parts.push(para('Приложения: документы, подтверждающие указанные обстоятельства (перечень и число листов уточнить при подаче): '+d.proof+'.','normal'));
  }else{
    parts.push(para(`Копию судебного приказа я получил(а) ${d.received}. Настоящие возражения подаю относительно исполнения судебного приказа.`));
    parts.push(para('Руководствуясь статьями 128 и 129 ГПК РФ, прошу суд:'));
    parts.push(para(`1. Отменить судебный приказ от ${d.date} по делу № ${d.case}.`,'normal'));
    parts.push(para('2. Направить мне копию определения об отмене судебного приказа.','normal'));
  }
  parts.push(para(`Дата: ${d.created}                  Подпись: ______________ /${d.debtor}/`,'signature'));
  return parts;
}
function displayDocument(parts){const root=$('#preview'), print=$('#print-sheet');for(const target of [root,print]){
  target.replaceChildren();const sheet=document.createElement('div');sheet.className='doc-content';for(const part of parts){const el=document.createElement(part.style==='title'?'h3':'p');if(part.style==='right')el.className='right';if(part.style==='indent')el.className='indent';if(part.style==='signature')el.className='pre';el.textContent=part.text;sheet.append(el);}target.append(sheet);}}

/* Create a standards-compliant, UTF-8, STORE-method ZIP archive without external libraries. */
const te=new TextEncoder();
const crcTable=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}return table;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function write16(view,pos,x){view.setUint16(pos,x,true);}function write32(view,pos,x){view.setUint32(pos,x>>>0,true);}
function makeZip(entries){let total=22;const prepared=entries.map(([name,content])=>{const n=te.encode(name),b=te.encode(content),crc=crc32(b);total+=30+n.length+b.length+46+n.length;return {n,b,crc};});
  const buf=new ArrayBuffer(total),view=new DataView(buf),out=new Uint8Array(buf);let p=0;const directory=[];
  for(const entry of prepared){const {n,b,crc}=entry,offset=p;write32(view,p,0x04034b50);write16(view,p+4,20);write16(view,p+6,0x0800);write16(view,p+8,0);write16(view,p+10,0);write16(view,p+12,0);write32(view,p+14,crc);write32(view,p+18,b.length);write32(view,p+22,b.length);write16(view,p+26,n.length);write16(view,p+28,0);p+=30;out.set(n,p);p+=n.length;out.set(b,p);p+=b.length;directory.push({n,b,crc,offset});}
  const cdStart=p;for(const e of directory){write32(view,p,0x02014b50);write16(view,p+4,20);write16(view,p+6,20);write16(view,p+8,0x0800);write16(view,p+10,0);write16(view,p+12,0);write16(view,p+14,0);write32(view,p+16,e.crc);write32(view,p+20,e.b.length);write32(view,p+24,e.b.length);write16(view,p+28,e.n.length);write16(view,p+30,0);write16(view,p+32,0);write16(view,p+34,0);write16(view,p+36,0);write32(view,p+38,0);write32(view,p+42,e.offset);p+=46;out.set(e.n,p);p+=e.n.length;}
  const cdSize=p-cdStart;write32(view,p,0x06054b50);write16(view,p+4,0);write16(view,p+6,0);write16(view,p+8,directory.length);write16(view,p+10,directory.length);write32(view,p+12,cdSize);write32(view,p+16,cdStart);write16(view,p+20,0);p+=22;if(p!==total)throw Error('Ошибка формирования ZIP-архива');return new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}
const escapeXML=(v)=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const run=(t,bold=false)=>`<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/>${bold?'<w:b/>':''}</w:rPr><w:t xml:space="preserve">${escapeXML(t)}</w:t></w:r>`;
function asParagraph(part){const align=part.style==='right'?'right':part.style==='title'?'center':'both';const bold=part.style==='title';const indent=part.style==='indent'?'<w:ind w:firstLine="709"/>':'';const spacing=part.style==='right'?'<w:spacing w:after="50"/>':'<w:spacing w:after="160" w:line="360" w:lineRule="auto"/>';
  const pPr=`<w:pPr><w:jc w:val="${align}"/>${indent}${spacing}${bold?'<w:keepNext/>':''}</w:pPr>`;
  const text=part.text.split('\n').map(t=>run(t,bold)).join('<w:r><w:br/></w:r>');
  return `<w:p>${pPr}${text}</w:p>`;
}
function makeDocx(parts){const doc=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.map(asParagraph).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:style></w:styles>`;
 return makeZip([
 ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
 ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
 ['word/document.xml',doc],
 ['word/styles.xml',styles],
 ['word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]
 ]);
}
function downloadDocx(){try{const blob=makeDocx(buildDocument()),url=URL.createObjectURL(blob);const a=document.createElement('a');const suffix=value('case').replace(/[^\w\d-]/g,'_').slice(0,45);a.href=url;a.download=`INVAL_vozrazheniya_${suffix||'prikaz'}.docx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}catch(err){alertMessage('Не удалось создать Word: '+err.message);}}
function reset(){const ok=confirm('Удалить все введённые сведения из этой вкладки и начать заново?');if(!ok)return;for(const id of values)$('#'+id).value='';$('#confirm-gpk').checked=false;$('#confirm-proof').checked=false;$('input[name=route][value=normal]').checked=true;$('#file-input').value='';$('#raw-text').value='';recognizedText='';detectedType='unknown';show($('#recognized-info'),false);renderLocalHints('');show($('#recognition-status'),false);$('#preview').replaceChildren();$('#print-sheet').replaceChildren();updateRoute();setStep(1);}

$('#go-2').addEventListener('click',()=>setStep(2));
$('#go-3').addEventListener('click',()=>{if(validateFields())setStep(3);});
$('#go-4').addEventListener('click',()=>{if(validateRoute()){const parts=buildDocument();displayDocument(parts);setStep(4);}});
$$('[data-prev]').forEach(b=>b.addEventListener('click',()=>setStep(+b.dataset.prev)));
$$('input[name=route]').forEach(r=>r.addEventListener('change',updateRoute));
$('#received-date').addEventListener('input',updateTermNote);
$('#download-docx').addEventListener('click',downloadDocx);
$('#download-pdf').addEventListener('click',()=>window.print());
$('#reset').addEventListener('click',reset);
$('#reparse').addEventListener('click',()=>{recognizedText=$('#raw-text').value.slice(0,40000);updateKind();const n=fillFromText(recognizedText);renderLocalHints(recognizedText);alertMessage(`Найдено новых реквизитов: ${n}. Уже заполненные поля не перезаписывались.`, 'notice');});
$('#file-input').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';readDocument(file);});
const zone=$('#dropzone');
zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag');});
zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));
zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag');readDocument(e.dataTransfer?.files?.[0]);});
window.addEventListener('beforeunload',()=>{if(ocrWorker){ocrWorker.terminate().catch(()=>{});ocrWorker=null;}});
