export default [
  {
    id: 'blocks-basic', category: 'blocks', contract: 'normalized',
    inputPath: '01-blocks.input.md', expectedPath: '01-blocks.expected.md',
  },
  {
    id: 'marks-links', category: 'marks', contract: 'normalized',
    inputPath: '02-marks-links.input.md', expectedPath: '02-marks-links.expected.md',
  },
  {
    id: 'hard-break-rule', category: 'blocks', contract: 'normalized',
    inputPath: '03-breaks-rule.input.md', expectedPath: '03-breaks-rule.expected.md',
  },
  {
    id: 'lists-basic', category: 'lists', contract: 'normalized',
    inputPath: '04-lists-basic.input.md', expectedPath: '04-lists-basic.expected.md',
  },
  {
    id: 'lists-mixed-tasks', category: 'lists', contract: 'normalized',
    inputPath: '05-lists-mixed-tasks.input.md', expectedPath: '05-lists-mixed-tasks.expected.md',
  },
  {
    id: 'lists-nested-loose', category: 'lists', contract: 'normalized',
    inputPath: '06-lists-nested-loose.input.md', expectedPath: '06-lists-nested-loose.expected.md',
  },
  {
    id: 'quote-nested', category: 'quotes', contract: 'normalized',
    inputPath: '07-quote-nested.input.md', expectedPath: '07-quote-nested.expected.md',
  },
  {
    id: 'code-blank', category: 'code', contract: 'normalized',
    inputPath: '08-code-blank.input.md', expectedPath: '08-code-blank.expected.md',
  },
  {
    id: 'code-tilde-info', category: 'code', contract: 'normalized',
    inputPath: '09-code-tilde.input.md', expectedPath: '09-code-tilde.expected.md',
  },
  {
    id: 'table-cjk-escaped-pipe', category: 'tables', contract: 'normalized',
    inputPath: '10-table-cjk.input.md', expectedPath: '10-table-cjk.expected.md',
  },
  {
    id: 'table-column-alignment', category: 'tables', contract: 'blocker',
    inputPath: '11-table-align.input.md',
    currentLossyPath: '11-table-align.current-lossy.md',
    desiredPath: '11-table-align.desired.md',
    reason: 'GFM left, center, and right column alignment is discarded by the ProseMirror bridge.',
    requiredFragments: ['Left', 'Center', 'Right', 'alpha', 'beta', 'gamma'],
  },
  {
    id: 'frontmatter-boundary', category: 'frontmatter', contract: 'verbatim',
    inputPath: '12-frontmatter.input.md', expectedPath: '12-frontmatter.expected.md',
    requiredFragments: ['title: Corpus Note', 'aliases:\n  - 测试', 'enabled: true'],
  },
  {
    id: 'math-currency-delimiter', category: 'math', contract: 'blocker',
    inputPath: '13-math-currency.input.md',
    currentLossyPath: '13-math-currency.current-lossy.md',
    desiredPath: '13-math-currency.desired.md',
    reason: 'A currency dollar before inline math is parsed as a math opener and corrupts the intended inline expression.',
    requiredFragments: ['The price is', 'inline math is', '\\sum_{i=1}^{n} i'],
  },
  {
    id: 'mermaid-source', category: 'mermaid', contract: 'normalized',
    inputPath: '14-mermaid.input.md', expectedPath: '14-mermaid.expected.md',
    requiredFragments: ['graph TD', 'A[开始] --> B{Done?}', 'B -->|yes| C[结束]'],
  },
  {
    id: 'image-inline-unsafe-and-unicode', category: 'images', contract: 'normalized',
    inputPath: '15-image-inline.input.md', expectedPath: '15-image-inline.expected.md',
    requiredFragments: ['javascript:alert\\(1\\)', 'https://example.com/图像.png'],
  },
  {
    id: 'image-vault-relative', category: 'images', contract: 'normalized',
    inputPath: '16-image-relative.input.md', expectedPath: '16-image-relative.expected.md',
    requiredFragments: ['./assets/screenshots/example.png'],
  },
  {
    id: 'image-reference', category: 'images', contract: 'verbatim',
    inputPath: '17-image-reference.input.md', expectedPath: '17-image-reference.expected.md',
    requiredFragments: ['![diagram][img]', '[img]: ./assets/diagram.png "Diagram"'],
  },
  {
    id: 'image-reference-unresolved', category: 'images', contract: 'verbatim',
    inputPath: '18-image-unresolved.input.md', expectedPath: '18-image-unresolved.expected.md',
    requiredFragments: ['missing', 'no-such-definition'],
  },
  {
    id: 'raw-html', category: 'raw', contract: 'verbatim',
    inputPath: '19-raw-html.input.md', expectedPath: '19-raw-html.expected.md',
    requiredFragments: ['<kbd>Cmd</kbd>', '<section data-kind="raw">', '<strong>Keep me</strong>'],
  },
  {
    id: 'references-footnote', category: 'references', contract: 'verbatim',
    inputPath: '20-references-footnote.input.md', expectedPath: '20-references-footnote.expected.md',
    requiredFragments: ['[reference link][docs]', 'https://example.com/docs', '[^long]: First paragraph.', 'nested footnote item'],
  },
  {
    id: 'unicode-escapes', category: 'unicode', contract: 'normalized',
    inputPath: '21-unicode-escapes.input.md', expectedPath: '21-unicode-escapes.expected.md',
    requiredFragments: ['https://example.com/路径', 'café', 'é', '中文标点，', '😀'],
  },
  {
    id: 'line-endings-crlf', category: 'line-endings', contract: 'normalized',
    inputPath: '22-line-endings.input.md', expectedPath: '22-line-endings.expected.md',
    transform: 'crlf',
  },
  {
    id: 'line-endings-no-final-newline', category: 'line-endings', contract: 'normalized',
    inputPath: '22-line-endings.input.md', expectedPath: '22-line-endings.expected.md',
    transform: 'strip-final-newline',
  },
  {
    id: 'empty-input', category: 'empty', contract: 'normalized',
    inputPath: '23-empty.input.md', expectedPath: '23-empty.expected.md',
    transform: 'strip-final-newline',
  },
  {
    id: 'whitespace-input', category: 'empty', contract: 'normalized',
    inputPath: '24-whitespace.input.md', expectedPath: '23-empty.expected.md',
  },
  {
    id: 'long-mixed', category: 'long-document', contract: 'normalized',
    inputPath: '25-long-mixed.input.md', expectedPath: '25-long-mixed.expected.md',
  },
];
