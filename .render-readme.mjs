import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { readFileSync, writeFileSync } from 'node:fs';
const p = await createMarkdownProcessor({ syntaxHighlight: false });
let { code } = await p.render(readFileSync('README.md', 'utf8'));
code = code.replace(/src="docs\//g, 'src="file:///home/claude/repo/docs/').replace(/srcset="docs\//g, 'srcset="file:///home/claude/repo/docs/');
const css = 'body{background:#0d1117;color:#e6edf3;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:900px;margin:0 auto;padding:32px}a{color:#4493f8}table{border-collapse:collapse}td,th{border:1px solid #3d444d;padding:6px 13px}img{max-width:100%}h2{border-bottom:1px solid #3d444d;padding-bottom:.3em}code{background:#262c36;padding:.2em .4em;border-radius:6px}pre{background:#151b23;padding:16px;border-radius:6px}blockquote{border-left:4px solid #9e6a03;margin:0;padding:0 1em;color:#e6edf3}';
writeFileSync('/tmp/claude-0/-home-claude-repo/380b1615-6801-5a82-8943-6bd878923541/scratchpad/readme-preview.html', '<meta charset=utf-8><style>' + css + '</style>' + code);
