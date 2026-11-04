'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const app = $('#app'), page = $('#page'), popover = $('#popover');
  const originals = structuredClone(window.demoDocuments);
  let documents = structuredClone(originals), active = null, category = 'recent', view = 'write';
  let theme = 'light', settingsTab = 'appearance', savedRange = null, toastTimer, backupTimer, searchIndex = 0;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${window.demoIcons[name] || window.demoIcons.file}</svg>`;
  const current = () => documents.find(d => d.id === active);
  function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = icon(n.dataset.icon); }); }
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 2800); }
  function closePopover() { popover.hidden = true; }
  function openDialog(id) { closePopover(); const dialog = $(id); dialog.showModal(); return dialog; }
  function visibleDocuments() { return documents.filter(d => category === 'archived' ? d.archived : !d.archived && (category === 'starred' ? d.star : category === 'drafts' ? d.draft : true)); }
  function renderList() {
    document.querySelectorAll('[data-nav]').forEach(b => { const selected = b.dataset.nav === category; b.classList.toggle('active', selected); b.setAttribute('aria-current', selected ? 'page' : 'false'); });
    $('#recent-count').textContent = documents.filter(d => !d.archived).length;
    $('#star-count').textContent = documents.filter(d => d.star && !d.archived).length;
    $('#draft-count').textContent = documents.filter(d => d.draft && !d.archived).length;
    $('#archive-count').textContent = documents.filter(d => d.archived).length;
    $('#list-label').textContent = ({recent:'文档',starred:'留在手边',drafts:'继续写作',archived:'已归档文档'})[category];
    $('#document-list').innerHTML = visibleDocuments().map(d => `<button class="doc-item ${d.id === active ? 'active' : ''}" data-doc="${d.id}" ${d.id === active ? 'aria-current="page"' : ''}>${icon(d.draft?'file-pen':'file')}<span class="doc-item-content"><strong>${escape(d.title)}</strong><small>${escape(d.group)} <span>·</span> ${escape(d.time)}</small></span></button>`).join('') || '<div class="list-empty">这里还没有文档。<br>从一页新的草稿开始吧。</div>';
  }
  function sourceText() {
    const clone = page.cloneNode(true); clone.querySelectorAll('.eyebrow,.signature').forEach(n => n.remove());
    return [...clone.children].map(n => {
      const t = n.textContent.trim(); if (/H[1-6]/.test(n.tagName)) return '#'.repeat(Number(n.tagName[1]))+' '+t;
      if (n.tagName === 'BLOCKQUOTE') return '> '+t;
      if (n.tagName === 'PRE') return '```\n'+t+'\n```';
      if (n.tagName === 'UL' || n.tagName === 'OL') return [...n.children].map((li,i) => (n.tagName==='OL' ? `${i+1}. ` : '- ')+li.textContent.trim()).join('\n');
      return t;
    }).join('\n\n');
  }
  function updateOutline() {
    const headings = [...page.querySelectorAll('h2,h3')];
    $('#outline-items').innerHTML = headings.map((h,i) => { h.id='section-'+i; return `<button data-heading="${h.id}" class="${i===0?'active ':''}${h.tagName==='H3'?'sub':''}">${escape(h.textContent)}</button>`; }).join('') || '<p class="list-empty">添加标题后，<br>大纲会显示在这里。</p>';
  }
  function updateStats() { const text = page.innerText.trim(); $('#word-count').textContent = text.replace(/\s/g,'').length.toLocaleString()+' 字'; $('#reading-time').textContent = '约 '+Math.max(1,Math.ceil(text.length/450))+' 分钟'; }
  function setStatus(text, dot=true) { $('#document-status').innerHTML = (dot?'<span class="status-dot"></span>':'')+escape(text); }
  function remember() { if (current() && !$('#page').hidden) current().html = page.innerHTML; }
  function openDocument(id) {
    remember(); clearTimeout(backupTimer); active=id; const d=current(); if (!d) return;
    app.classList.remove('home-mode'); $('#home-view').hidden=true; $('#document-title').textContent=d.title; $('.file-extension').hidden=false;
    $('#editor-tools').hidden=false; $('.document-stats').hidden=false; $('#notice').hidden=true; $('#preview-state').value='normal';
    page.innerHTML=d.html; savedRange=null; setView('write'); updateOutline(); updateStats(); renderList();
    setStatus(d.archived?'已归档 · 可继续阅读':d.exported?'当前内容已导出':'本地草稿已备份');
    app.classList.remove('mobile-sidebar'); $('#document-scroll').scrollTop=0; closePopover();
  }
  function setView(next) {
    view=next; const source=next==='source'; page.hidden=source; $('#source-view').hidden=!source;
    if(source) $('#source-view').value=sourceText(); page.contentEditable=String(next==='write' && !current()?.archived);
    app.classList.toggle('read-mode', next!=='write');
    document.querySelectorAll('[data-view]').forEach(b => {b.classList.toggle('active',b.dataset.view===next);b.setAttribute('aria-pressed',String(b.dataset.view===next));});
  }
  function home() {
    remember(); active=null; app.classList.add('home-mode'); $('#home-view').hidden=false; page.hidden=true; $('#source-view').hidden=true; $('#editor-tools').hidden=true;
    $('#notice').hidden=true; $('#document-title').textContent='开始写作'; $('.file-extension').hidden=true; $('.document-stats').hidden=true;
    $('#outline-items').innerHTML=''; setStatus('所有文字，都从一页空白开始',false); renderList();
    $('#home-view').innerHTML=`<span class="home-kicker">属于你的写作空间</span><h1>写下此刻的想法。</h1><p class="intro">从一页空白开始，或回到尚未写完的故事。</p><div class="home-actions"><button class="primary-button" data-action="new">${icon('plus')}新建文档</button><button class="secondary-button" data-action="search">${icon('folder')}打开文档</button></div><h2 class="home-section-title">继续上次的写作</h2>${documents.filter(d=>!d.archived).slice(0,4).map(d=>`<button class="home-recent" data-doc="${d.id}">${icon('file')}<span><strong>${escape(d.title)}</strong><small>${escape(d.group)} · Markdown 文档</small></span><span class="time">${escape(d.time)}</span></button>`).join('')}`;
    app.classList.remove('mobile-sidebar');
  }
  function newDocument() {
    const n=documents.filter(d=>d.id.startsWith('new-')).length+1,id='new-'+n;
    documents.unshift({id,title:'未命名 '+n,group:'本地草稿',time:'刚刚',draft:true,star:false,html:'<p class="eyebrow" contenteditable="false">一个新的开始</p><h1 data-placeholder="文档标题"></h1><p data-placeholder="在这里，写下第一句话。"></p>'});
    category='drafts'; openDocument(id); page.focus();
  }
  function showPopover(trigger, html) {
    if(!popover.hidden && popover.dataset.trigger === trigger.dataset.action){closePopover();return;}
    popover.innerHTML=html; popover.hidden=false; popover.dataset.trigger=trigger.dataset.action; icons(popover);
    const b=trigger.getBoundingClientRect(),a=app.getBoundingClientRect();
    popover.style.left=Math.max(10,Math.min(b.left-a.left,app.clientWidth-popover.offsetWidth-12))+'px';
    popover.style.top=Math.max(10,Math.min(b.bottom-a.top+7,app.clientHeight-popover.offsetHeight-12))+'px';
  }
  const menuItem=(action,label,key='',glyph='')=>`<button data-action="${action}">${glyph?icon(glyph):''}${label}${key?`<kbd>${key}</kbd>`:''}</button>`;
  function showInfo(trigger) { showPopover(trigger,`<div class="info-body"><h3>${escape(current()?.title||'Markdown')}</h3><dl><dt>文档类型</dt><dd>Markdown</dd><dt>当前状态</dt><dd>${current()?.exported?'已演示导出当前内容':'独立写作草稿'}</dd><dt>本地备份</dt><dd>刚刚 · 演示状态</dd></dl><p>导出后的文件与草稿相互独立。<br>此原型不执行真实备份或保存。</p></div>`); }
  function mutate(fn) { if(!current()||view!=='write'||current().archived)return; fn(); remember(); updateOutline(); updateStats(); current().exported=false; setStatus('草稿有修改 · 演示'); }
  function insertBlock(html) { mutate(()=>{const t=document.createElement('template');t.innerHTML=html;page.append(t.content);page.lastElementChild?.scrollIntoView({block:'nearest'});}); closePopover(); }
  function format(kind) {
    if(!current()||view!=='write'||current().archived){toast('请先打开一份可编辑草稿');return;}
    const r=savedRange;
    if(['bold','italic','code'].includes(kind)) {
      if(!r||r.collapsed||!page.contains(r.commonAncestorContainer)){toast('先选中一段文字，再应用格式');return;}
      mutate(()=>{const node=document.createElement({bold:'strong',italic:'em',code:'code'}[kind]);node.append(r.extractContents());r.insertNode(node);const next=document.createRange();next.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(next);savedRange=next;});
    } else if(kind==='quote') insertBlock('<blockquote><p>在这里，留下一句值得记住的话。</p></blockquote>');
    else if(['paragraph','h1','h2','h3'].includes(kind)) {
      let node=r?.startContainer; if(node?.nodeType===3)node=node.parentElement; const block=node?.closest('p,h1,h2,h3');
      if(!block||!page.contains(block)||block.classList.contains('eyebrow')){toast('点击正文中的段落，再选择样式');return;}
      mutate(()=>{const next=document.createElement(kind==='paragraph'?'p':kind);next.innerHTML=block.innerHTML;block.replaceWith(next);});
    }
    closePopover();
  }
  function search() { openDialog('#search-dialog'); $('#search-input').value='';searchIndex=0;renderSearch();$('#search-input').focus(); }
  function renderSearch() {
    const q=$('#search-input').value.trim().toLowerCase(); const found=documents.filter(d=>!d.archived&&(d.title+' '+d.html.replace(/<[^>]*>/g,'')).toLowerCase().includes(q));
    searchIndex=Math.min(searchIndex,Math.max(0,found.length-1));
    $('#search-results').innerHTML=`<div class="search-label">${q?'搜索结果':'最近文档'}</div>`+found.map((d,i)=>`<button class="search-result ${i===searchIndex?'selected':''}" data-doc="${d.id}">${icon('file')}<span><strong>${escape(d.title)}</strong><small>${escape(d.group)} · ${escape(d.time)}</small></span>${i===searchIndex?'<kbd>↵</kbd>':''}</button>`).join('')+(found.length?'':'<div class="list-empty">没有找到相关文档。试试其他关键词。</div>');
  }
  function applyTheme(value) { theme=value; const dark=value==='dark'||value==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;document.body.dataset.theme=dark?'dark':'light'; }
  function settings(tab='appearance') { settingsTab=tab; if(!$('#settings-dialog').open)openDialog('#settings-dialog'); renderSettings(); }
  function renderSettings() {
    document.querySelectorAll('[data-settings]').forEach(b=>b.classList.toggle('active',b.dataset.settings===settingsTab));
    const row=(label,detail,control)=>`<div class="settings-row"><span>${label}${detail?`<small>${detail}</small>`:''}</span>${control}</div>`;
    let html='';
    if(settingsTab==='appearance') html=`<h3>外观主题</h3><div class="theme-options">${[['light','浅色'],['dark','深色'],['system','跟随系统']].map(([value,label])=>`<button class="theme-card ${theme===value?'active':''}" data-theme="${value}" aria-pressed="${theme===value}"><span class="theme-preview ${value}"></span>${label}</button>`).join('')}</div><h3>正文排版</h3>${row('正文字体','只影响阅读外观','<select id="font-setting" aria-label="正文字体"><option value="sans">简洁黑体</option><option value="serif">书刊宋体</option></select>')}${row('字号','适合你的阅读距离','<select id="size-setting" aria-label="正文字号"><option value="16">16 px</option><option value="17">17 px</option><option value="19">19 px</option><option value="21">21 px</option></select>')}${row('页面宽度','留白也属于文字','<select id="width-setting" aria-label="页面宽度"><option value="580">紧凑</option><option value="680">舒适</option><option value="800">宽阔</option></select>')}`;
    if(settingsTab==='writing') html=`<h3>让写作更自然</h3>${row('显示文档大纲','快速回到文章的任意位置','<input id="outline-setting" type="checkbox" aria-label="显示文档大纲">')}${row('拼写检查','浏览器的本地拼写提示','<input id="spell-setting" type="checkbox" aria-label="拼写检查">')}${row('专注模式','收起两侧面板，留出完整的一页','<button class="secondary-button" data-action="settings-focus">进入专注</button>')}<p class="settings-note">这里只预览写作外观。自动备份、文件保存与输入法处理继续由正式应用负责。</p>`;
    if(settingsTab==='shortcuts') html='<h3>常用快捷键</h3>'+[['搜索文档','⌘ K'],['新建文档','⌘ N'],['查找文档','⌘ O'],['加粗选中文字','⌘ B'],['专注模式','⌘ ⇧ F'],['打开设置','⌘ ,'],['关闭面板','Esc']].map(([a,b])=>row(a,'',`<kbd>${b}</kbd>`)).join('');
    if(settingsTab==='about') html='<span class="brand-mark">m<span>↓</span></span><h3 class="about-title">Markdown</h3><p class="modal-description">一页纸的空间。<br>一个安静、清晰、自然的写作工具。</p><p class="settings-note">交互设计原型 · 2026.11<br>页面内为合成示例。所有修改仅存在于本次打开的页面，刷新会重置。没有文件读写、账号或网络连接。</p>';
    $('#settings-body').innerHTML=html;
    if($('#size-setting')) {$('#size-setting').value=document.documentElement.style.getPropertyValue('--body-size').replace('px','')||'17';$('#width-setting').value=document.documentElement.style.getPropertyValue('--page-width').replace('px','')||'680';$('#font-setting').value=document.body.dataset.font||'sans';}
    if($('#outline-setting')) {$('#outline-setting').checked=!app.classList.contains('outline-hidden');$('#spell-setting').checked=page.spellcheck;}
  }
  function toggleFocus() { app.classList.toggle('focus-mode');closePopover(); }
  const actions={
    sidebar:()=>{if(innerWidth<=760)app.classList.toggle('mobile-sidebar');else app.classList.toggle('sidebar-hidden');},
    outline:()=>{const hidden=app.classList.toggle('outline-hidden');document.querySelector('[data-action=outline]').setAttribute('aria-pressed',String(!hidden));},
    focus:toggleFocus, home, new:newDocument, search, settings:()=>settings(), typography:()=>settings(), info:showInfo,
    export:()=>{if(!current()){newDocument();}$('#export-name').value=current().title;openDialog('#export-dialog');},
    more:b=>showPopover(b,menuItem('star',current()?.star?'取消收藏':'收藏文档','','star')+menuItem('duplicate','创建副本','','file-pen')+menuItem('rename','重命名','','file')+'<hr>'+menuItem('archive',current()?.archived?'放回最近文档':'归档文档','','archive')+menuItem('info','文档信息','','info')),
    'format-menu':b=>showPopover(b,'<div class="popover-label">段落样式</div>'+[['paragraph','正文'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3']].map(([k,v])=>`<button data-format="${k}">${v}</button>`).join('')),
    'list-menu':b=>showPopover(b,menuItem('bullet','无序列表','','list')+menuItem('ordered','有序列表','','list')+menuItem('tasks','任务列表','','check')),
    insert:b=>showPopover(b,'<div class="popover-label">插入到文档末尾</div>'+menuItem('insert-table','表格','','table')+menuItem('insert-code','代码块','','code')+menuItem('insert-image','图片样张','','image')+menuItem('insert-rule','分隔线','','minus')),
    bullet:()=>insertBlock('<ul><li>第一件事</li><li>接下来的一件事</li></ul>'),ordered:()=>insertBlock('<ol><li>整理想法</li><li>开始写作</li></ol>'),tasks:()=>insertBlock('<ul class="checklist"><li><input type="checkbox" aria-label="新的待办"><span>新的一项待办</span></li></ul>'),
    'insert-code':()=>insertBlock('<pre><code>// 从这里开始\nconst idea = "一个新的想法";</code></pre>'),
    'insert-table':()=>insertBlock('<table><thead><tr><th>项目</th><th>备注</th></tr></thead><tbody><tr><td>新的想法</td><td>慢慢展开</td></tr><tr><td>下一个步骤</td><td>从小处开始</td></tr></tbody></table>'),
    'insert-image':()=>insertBlock('<figure class="sample-image"><div>'+icon('image')+'<span>图片样张</span></div><figcaption>为这一刻，留下一幅画面。</figcaption></figure>'),
    'insert-rule':()=>insertBlock('<hr><p>新的段落。</p>'),link:()=>openDialog('#link-dialog'),
    star:()=>{if(current()){current().star=!current().star;renderList();toast(current().star?'已加入收藏':'已取消收藏');}closePopover();},
    duplicate:()=>{if(!current())return;const d=structuredClone(current());d.id='copy-'+Date.now();d.title+=' · 副本';d.archived=false;d.draft=true;d.time='刚刚';documents.unshift(d);category='recent';openDocument(d.id);toast('已创建示例副本');},
    rename:()=>{closePopover();if(!current())return;const h=page.querySelector('h1');if(h){h.focus();const r=document.createRange();r.selectNodeContents(h);getSelection().removeAllRanges();getSelection().addRange(r);toast('修改正文标题，文档名称会随之更新');}},
    archive:()=>{if(!current())return;current().archived=!current().archived;category=current().archived?'archived':'recent';openDocument(active);toast(current().archived?'已归档，可随时放回':'已放回最近文档');},
    'settings-focus':()=>{$('#settings-dialog').close();toggleFocus();},dismiss:()=>{$('#notice').hidden=true;}
  };
  document.addEventListener('click',e=>{
    const close=e.target.closest('[data-close]');if(close){close.closest('dialog').close();return;}
    const doc=e.target.closest('[data-doc]');if(doc){if($('#search-dialog').open)$('#search-dialog').close();openDocument(doc.dataset.doc);return;}
    const nav=e.target.closest('[data-nav]');if(nav){category=nav.dataset.nav;renderList();if(category==='drafts'||category==='archived') {const d=visibleDocuments()[0];if(d)openDocument(d.id);else home();}return;}
    const heading=e.target.closest('[data-heading]');if(heading){$('#'+heading.dataset.heading)?.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('[data-heading]').forEach(b=>b.classList.toggle('active',b===heading));return;}
    const v=e.target.closest('[data-view]');if(v){setView(v.dataset.view);return;}
    const t=e.target.closest('button[data-theme]');if(t){applyTheme(t.dataset.theme);renderSettings();return;}
    const st=e.target.closest('[data-settings]');if(st){settings(st.dataset.settings);return;}
    const f=e.target.closest('[data-format]');if(f){format(f.dataset.format);return;}
    const b=e.target.closest('[data-action]');if(b){actions[b.dataset.action]?.(b);return;}
    if(!popover.contains(e.target))closePopover();
    if(e.target.closest('.page a')){e.preventDefault();toast('链接交互样式 · 原型不打开外部地址');}
  });
  document.addEventListener('selectionchange',()=>{const s=getSelection();if(s.rangeCount&&page.contains(s.anchorNode))savedRange=s.getRangeAt(0).cloneRange();});
  page.addEventListener('input',()=>{if(!current())return;current().html=page.innerHTML;current().draft=true;current().exported=false;const title=page.querySelector('h1')?.textContent.trim();if(title){current().title=title;$('#document-title').textContent=title;}renderList();updateStats();updateOutline();setStatus('正在备份…');clearTimeout(backupTimer);backupTimer=setTimeout(()=>setStatus('本地草稿已备份 · 演示'),700);});
  page.addEventListener('compositionstart',()=>{clearTimeout(backupTimer);setStatus('输入中…');});
  page.addEventListener('compositionend',()=>setStatus('本地草稿已备份 · 演示'));
  $('#search-input').addEventListener('input',()=>{searchIndex=0;renderSearch();});
  $('#search-input').addEventListener('keydown',e=>{const results=[...document.querySelectorAll('.search-result')];if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();searchIndex=(searchIndex+(e.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length);renderSearch();}if(e.key==='Enter'){e.preventDefault();results[searchIndex]?.click();}});
  $('#confirm-export').onclick=()=>{if(!$('#export-name').value.trim()){$('#export-name').focus();return;}current().exported=true;$('#export-dialog').close();setStatus('当前内容已导出 · 演示');toast('已演示另存为「'+$('#export-name').value.trim()+'.md」');};
  $('#link-form').onsubmit=e=>{e.preventDefault();const text=$('#link-text').value,url=$('#link-url').value;if(!/^https?:\/\//i.test(url))return;insertBlock('<p><a href="'+escape(url)+'">'+escape(text)+'</a></p>');$('#link-dialog').close();};
  $('#settings-body').addEventListener('change',e=>{const {id,value,checked}=e.target;if(id==='size-setting')document.documentElement.style.setProperty('--body-size',value+'px');if(id==='width-setting')document.documentElement.style.setProperty('--page-width',value+'px');if(id==='font-setting'){document.body.dataset.font=value;document.documentElement.style.setProperty('--body-font',value==='serif'?"'Songti SC',Georgia,serif":"-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif");}if(id==='outline-setting'){app.classList.toggle('outline-hidden',!checked);document.querySelector('[data-action=outline]').setAttribute('aria-pressed',String(checked));}if(id==='spell-setting')page.spellcheck=checked;});
  $('#preview-state').onchange=e=>{if(!current())openDocument('essay');$('#notice').hidden=true;if(e.target.value==='empty'){newDocument();$('#preview-state').value='empty';}else if(e.target.value==='typing')setStatus('输入中…');else if(e.target.value==='error'){$('#notice').innerHTML=icon('info')+'<span>新文件尚未确认，文字仍保留在当前草稿。<br>请检查保存位置后再继续。</span><button data-action="dismiss">知道了</button>';$('#notice').hidden=false;setStatus('本地草稿已保留');}else setStatus('本地草稿已备份');};
  $('#reset-demo').onclick=()=>{clearTimeout(backupTimer);documents=structuredClone(originals);active=null;category='recent';app.classList.remove('focus-mode','outline-hidden','sidebar-hidden');applyTheme('light');for(const key of ['--body-size','--page-width','--body-font'])document.documentElement.style.removeProperty(key);document.querySelector('[data-action=outline]').setAttribute('aria-pressed','true');document.body.dataset.font='sans';openDocument('essay');toast('已恢复示例内容');};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePopover();if(!document.querySelector('dialog[open]'))app.classList.remove('focus-mode','mobile-sidebar');return;}if(document.querySelector('dialog[open]'))return;if(e.metaKey||e.ctrlKey){const k=e.key.toLowerCase();if(k==='k'||k==='o'){e.preventDefault();search();}if(k==='n'){e.preventDefault();newDocument();}if(k===','){e.preventDefault();settings();}if(k==='f'&&e.shiftKey){e.preventDefault();toggleFocus();}if(k==='b'){e.preventDefault();format('bold');}}});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(theme==='system')applyTheme('system');});
  for(const d of document.querySelectorAll('dialog')) d.addEventListener('click',e=>{if(e.target===d){const b=d.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)d.close();}});
  icons();applyTheme('light');openDocument('essay');
})();
