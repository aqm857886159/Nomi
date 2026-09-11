import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NomiMarkdown } from '../../common/NomiMarkdown';
import { V4AssistantMessage, V4UserBubble } from './AgentPanelV4Message';
import { V4ErrorBar, V4Process, V4ToolReceipt } from './AgentPanelV4Receipt';
import { V4Intervention, V4TaskCard } from './AgentPanelV4Cards';
import { projectV4Intervention } from './agentPanelV4Intervention';

// 介入槽的写口在生产里是必填（R28）。测试里显式给一份空壳，表示「这一格不验行为」。
const NO_HANDLERS = { onPlanToggle: () => undefined, onCollapsePlan: () => undefined }
const html = renderToStaticMarkup;
const text = '这是**「重点」**的句子\n\n| 参数 | 值 |\n| --- | --- |\n| 时长 | 8 |\n\n- 项目';
const labels = { copy: 'copy', retry: 'retry', continue: 'continue' };
const slotLabels = { confirm: 'yes', reject: 'no', escalate: 'always', cancel: 'cancel', confirmReject: 'no', collapsePlan: 'collapse', expandPlan: 'expand' };
const md = (source: string) => html(React.createElement(NomiMarkdown, { compact: true, profile: "agent-v4", children: source }));
describe('B2e 审计 D1–D13：单一 Markdown 内核', () => {
    it('D1 代码复制消费内核 source，禁止从 ReactNode String 反提取', () => {
        const source = readFileSync('src/workbench/common/NomiMarkdown.tsx', 'utf8');
        expect(source).not.toContain('String(children');
        expect(source).toContain('Streamdown');
        expect(source).not.toContain('clipboard');
    });
    it('D2 停止前后都保留表格和列表', () => {
        for (const status of ['streaming', 'interrupted', 'complete'] as const) {
            const output = html(React.createElement(V4AssistantMessage, { text: text, status: status, labels: labels }));
            expect(output).toContain('<table');
            expect(output).toContain('<ul');
        }
    });
    it('D3 工具摘要及正文都是富文本，input JSON 仍可读', () => {
        const output = html(React.createElement(V4ToolReceipt, { receipt: { label: 'read', action: 'document', status: 'output-available', summary: '**摘要**', output: text, input: '{"limit":2}' }, statusLabel: "done" }));
        expect(output).toContain('<table');
        expect(output).toMatch(/<strong[^>]*>摘要<\/strong>/);
        expect(output).toContain('limit');
    });
    it('D4 审批投影保留完整 Markdown 和换行', () => {
        const content = '- **镜头一**：窗边\n- **镜头二**：茶杯\n' + '完整正文'.repeat(30);
        const output = projectV4Intervention({ toolName: 'append_to_end', args: { content }, effectClass: 'reversible_local', pendingCount: 1 }, { irreversible: '', reversible: '', spendBadge: '', credentialTitle: '', credentialConfirm: '', credentialAlternate: '', questionTitle: '', planTitle: '', more: '', scopeOnce: '', scopeCapability: '' }, key => key);
        expect(JSON.stringify(output)).toContain(JSON.stringify(content).slice(1, -1));
        expect(html(React.createElement(V4Intervention, { ...NO_HANDLERS, data: output!, labels: slotLabels }))).toContain('<ul');
    });
    it('D5 展开的过程段同样保留表格', () => {
        expect(html(React.createElement(V4Process, { label: "process", segments: [text] }))).toContain('<table');
    });
    it('D6 中文邻接强调和删除线不露标记', () => {
        const output = md('这是**「重点」**的句子，做~~「删除」~~测试。');
        expect(output).toMatch(/<strong[^>]*>「重点」<\/strong>/);
        expect(output).toMatch(/<del[^>]*>「删除」<\/del>/);
    });
    it('D7 高亮走官方 code 插件，无自写关键词规则', () => {
        expect(readFileSync('src/workbench/common/NomiMarkdown.tsx', 'utf8')).toContain('@streamdown/code');
    });
    it('D8 内部锚点不打开新窗', () => {
        const output = md('[脚注](#note)');
        expect(output).not.toContain('_blank');
        expect(output).not.toContain('↗');
    });
    it('D9 任务列表嵌套有正常缩进', () => {
        const output = md('- [ ] 父\n  - [x] 子');
        expect(output).not.toContain('pl-1 ');
        expect(output).toContain('disabled');
    });
    it('D10 图片引用保留可访问地址且不自动加载远程图片', () => {
        const output = md('![参考](https://example.com/reference.png)');
        expect(output).toContain('href="https://example.com/reference.png"');
        expect(output).not.toContain('<img');
    });
    it('D11 无语言围栏仍是块，不叠行内皮肤', () => {
        const output = md('```\n  first\n  last\n```');
        expect(output).toContain('data-streamdown="code-block"');
        expect(output).not.toContain('px-1 py-0.5');
    });
    it('D12 回答不折，用户输入只在超过 12 行时折', () => {
        const long = Array.from({ length: 13 }, (_, i) => `行 ${i}`).join('\n');
        expect(html(React.createElement(V4AssistantMessage, { text: long, status: "complete", labels: labels }))).not.toContain('<details');
        expect(html(React.createElement(V4UserBubble, { text: long }))).toContain('<details');
        expect(html(React.createElement(V4UserBubble, { text: long.split('\n').slice(0, 12).join('\n') }))).not.toContain('<details');
        expect(md('# 一级\n\n## 二级\n\n### 三级')).toMatch(/<h1[^>]*text-title/);
    });
    it('D13 流式光标归内核，不再匹配每个 p:last-of-type', () => {
        expect(readFileSync('src/workbench/ai/v4/vendor/aiElementsPrimitives.tsx', 'utf8')).not.toContain('[&_p:last-of-type]');
    });
    it('同类出口：任务、错误、计划都经同一内核', () => {
        expect(html(React.createElement(V4ErrorBar, { reason: text }))).toContain('<table');
        expect(html(React.createElement(V4TaskCard, { task: { title: 'task', action: 'document', status: 'complete', excerpt: text }, labels: { status: { queued: '', running: '', complete: '', failed: '', stopped: '' }, adopt: '', undo: '' } }))).toContain('<table');
        expect(html(React.createElement(V4Intervention, { ...NO_HANDLERS, data: { kind: 'plan', title: 'plan', plan: [{ label: '**步骤**', detail: text, checked: true }] }, labels: slotLabels }))).toContain('<table');
    });
});

// AST guard: source strings may be passed as props, but cannot become JSX text
// in a domain card. UI labels and technical input are outside this prose contract.
it('六出口结构防线：模型正文不能直接作为 JSX children', async () => {
    const ts = await import('typescript')
    const forbidden = new Set(['receipt.summary', 'receipt.output', 'group.reason', 'task.title', 'task.excerpt', 'task.error', 'data.summary', 'data.title', 'row.label', 'row.detail', 'segment', 'reason'])
    const violations: string[] = []
    for (const file of ['AgentPanelV4Receipt.tsx', 'AgentPanelV4Cards.tsx']) {
        const source = ts.createSourceFile(file, readFileSync(`src/workbench/ai/v4/${file}`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const visit = (node: import('typescript').Node) => {
            if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && forbidden.has(node.expression.getText(source))) violations.push(`${file}:${node.expression.getText(source)}`)
            ts.forEachChild(node, visit)
        }
        visit(source)
    }
    expect(violations).toEqual([])
})

it('多个消息的脚注 ID 不碰撞且 href 指向本消息定义', () => {
    const output = html(React.createElement('div', null, ...[1, 2].map(key => React.createElement(NomiMarkdown, { key, children: '正文[^1]\n\n[^1]: 本消息注释' }))))
    const ids = [...output.matchAll(/id="([^"]*fn-1)"/g)].map(match => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(output).toContain(`href="#${id}"`)
})

it('现役工具 JSON text envelope 解出正文，结构化元数据不丢弃', () => {
    const output = html(React.createElement(V4ToolReceipt, { receipt: { label: 'read', action: 'document', status: 'output-available', output: JSON.stringify({ text, revision: 3 }) }, statusLabel: 'done' }))
    expect(output).toContain('<table')
    expect(output).toContain('revision')
    expect(output).not.toContain('\\n')
})
