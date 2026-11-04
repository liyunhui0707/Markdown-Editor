'use strict';
// Entirely synthetic content. The prototype has no product API or filesystem connection.
window.demoIcons = {
  sidebar:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  'file-pen':'<path d="M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M12 3v6h6"/><path d="m17 12 3 3-6 6h-3v-3Z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  settings:'<path d="m9 3-.8 3-2.8.8-2 2 1.5 2.7L4 15l3 1.3L9 20l3-1 3 1 2-3.7 3-1.3-.9-3.5L20.6 9l-2-2-2.8-1L15 3Z"/><circle cx="12" cy="12" r="3"/>',
  focus:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path d="M9 12h6"/>',
  outline:'<path d="M9 5h12M9 12h9M9 19h12"/><circle cx="3" cy="5" r=".8"/><circle cx="3" cy="12" r=".8"/><circle cx="3" cy="19" r=".8"/>',
  export:'<path d="M12 16V3m-4 4 4-4 4 4M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  'chevron-down':'<path d="m7 10 5 5 5-5"/>',
  link:'<path d="m10 13 4-4M9 16l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-6 0" transform="translate(-1 0)"/>',
  code:'<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  quote:'<path d="M4 6h6v7H5c0 3-1 4-2 5M14 6h6v7h-5c0 3-1 4-2 5"/>',
  x:'<path d="m6 6 12 12M18 6 6 18"/>',
  feather:'<path d="M4 20 16 8M8 16c-3-3-2-7 2-10l5-3c5 0 7 5 3 9l-3 3c-2 2-5 3-7 1ZM11 13h6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 13h.1M10 13h.1M14 13h.1M18 13h.1M8 16h8"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  table:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M11 3v18"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m21 15-5-5-13 11"/>',
  minus:'<path d="M5 12h14"/>',
  arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>'
};
window.demoDocuments = [
  {id:'essay',title:'让文字，回到中心',group:'随笔',time:'刚刚',star:true,draft:true,html:`
    <p class="eyebrow" contenteditable="false">随笔 / 写作</p>
    <h1>让文字，回到中心</h1>
    <p class="lead">好的工具，应该让人忘记工具本身。<br>打开一页纸，留一点空白，然后开始。</p>
    <h2>一个安静的开始</h2>
    <p>清晨的光落在桌面上，咖啡还热着。那些零散的想法，不必急着整理成答案。先把它们写下来，让文字慢慢找到自己的形状。</p>
    <p>我们需要的，也许只是一个<strong>足够轻、足够专注</strong>的地方。没有抢夺注意力的面板，也没有每一次落笔都要回应的提醒。</p>
    <blockquote><p>写作不是把想法搬到纸上，<br>而是在纸上，继续思考。</p></blockquote>
    <h2>让结构自然生长</h2>
    <p>标题为思路留下一条小径，列表把凌乱变得清晰。Markdown 的美，在于简单的结构可以承载复杂的表达。</p>
    <ul><li>先记录，再整理。不让格式打断思考。</li><li>给段落留白，让阅读有自己的呼吸。</li><li>只在需要时打开工具，随时回到文字。</li></ul>
    <h2>把这一页，留给自己</h2>
    <p>一篇随笔、一份计划、一个尚未成形的念头。它们不需要宏大的开头，只需要一个可以继续写下去的地方。</p>
    <p>今天，从这一行开始。</p><hr><p class="signature">Markdown · 一页纸的空间</p>`},
  {id:'week',title:'这一周，慢慢来',group:'计划',time:'09:24',star:true,draft:false,html:`
    <p class="eyebrow" contenteditable="false">计划 / 日常</p><h1>这一周，慢慢来</h1><p class="lead">安排重要的事，也为意外留一点余地。</p>
    <h2>留给自己的一点时间</h2><ul class="checklist"><li><input type="checkbox" aria-label="读完一章书" checked><span>读完一章书，记下一个值得留下的句子</span></li><li><input type="checkbox" aria-label="去河边走走"><span>去河边走走，不带耳机</span></li><li><input type="checkbox" aria-label="写一篇短文"><span>把一个零散的念头写成短文</span></li></ul>
    <h2>本周安排</h2><table><thead><tr><th>时间</th><th>一件重要的事</th><th>留白</th></tr></thead><tbody><tr><td>周一</td><td>梳理写作提纲</td><td>一个安静的下午</td></tr><tr><td>周三</td><td>完成第一版草稿</td><td>傍晚散步</td></tr><tr><td>周五</td><td>回顾与整理</td><td>留给朋友</td></tr></tbody></table><h2>周末的留白</h2><p>计划不是要填满每一个小时。完成之后，记得给自己留出可以发呆的时间。</p>`},
  {id:'guide',title:'Markdown，小而美',group:'笔记',time:'昨天',star:false,draft:false,html:`
    <p class="eyebrow" contenteditable="false">笔记 / 方法</p><h1>Markdown，小而美</h1><p class="lead">用很少的符号，给文字恰到好处的秩序。</p><h2>轻巧的表达</h2><p>普通段落是写作的起点。用<strong>粗体强调重点</strong>，用<em>斜体留下语气</em>，也可以为一句话补上<a href="#">延伸阅读</a>。</p><h2>从代码到思路</h2><p>代码和文字可以自然地待在同一页。行内的 <code>hello()</code> 适合短小的表达，较长的示例则拥有自己的空间。</p><pre><code>// 一个很小的开始\nfunction hello(name) {\n  return &#96;你好，&#36;{name}。&#96;;\n}\n\nhello('世界');</code></pre><h2>保持简单</h2><ol><li>先把内容写完整。</li><li>用标题整理层次。</li><li>删去多余的修饰。</li></ol><blockquote><p>格式服务于内容，工具服务于表达。</p></blockquote>`},
  {id:'notes',title:'窗边的片刻',group:'随笔',time:'昨天',star:false,draft:false,html:`
    <p class="eyebrow" contenteditable="false">随笔 / 观察</p><h1>窗边的片刻</h1><p class="lead">一些不急着得出结论的记录。</p><h2>午后的光</h2><p>街角的树换了颜色。从窗边望出去，行人走过同一块阳光，每个人都只停留了一秒。</p><p>有时候，值得记录的事情并不特别。只因为那一刻，你注意到了它。</p><h2>留下一句话</h2><blockquote><p>生活的细节，往往在慢下来之后才变得清晰。</p></blockquote>`},
  {id:'archived',title:'夏日书单',group:'归档',time:'10 月 12 日',star:false,draft:false,archived:true,html:`<p class="eyebrow" contenteditable="false">归档 / 阅读</p><h1>夏日书单</h1><p class="lead">读过的书，和留下的回声。</p><h2>几本想再读的书</h2><ul><li>关于观察与日常的随笔</li><li>一本写给慢生活的散文集</li><li>旅行时带在身边的小册子</li></ul><p>这份示例已归档，可以通过菜单放回最近文档。</p>`}
];
