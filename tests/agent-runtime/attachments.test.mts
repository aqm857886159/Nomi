import assert from 'node:assert/strict';
import { test } from 'node:test';
import { injectPdfPayload, type NativePdf } from '../../electron/harness/runtime/pi/attachments.mjs';

const pdf: NativePdf = {
  marker: '[nomi-pdf:1]', fileName: 'coffee.pdf',
  data: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF').toString('base64'),
};

test('Anthropic receives native document bytes alongside text and image, not extracted text', () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'image-bytes' } };
  const payload = { model: 'claude-fixture', messages: [{ role: 'user', content: [
    { type: 'text', text: 'Read this' }, { type: 'text', text: pdf.marker }, image,
  ] }] };
  assert.deepEqual(injectPdfPayload(payload, 'anthropic-messages', [pdf]), {
    model: 'claude-fixture', messages: [{ role: 'user', content: [
      { type: 'text', text: 'Read this' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.data } }, image,
    ] }],
  });
  assert.equal(payload.messages[0].content[1].type, 'text', 'do not mutate history or provider-owned payload');
});

test('Responses receives input_file with filename and full data URL in the original position', () => {
  const image = { type: 'input_image', image_url: 'data:image/png;base64,image-bytes' };
  const payload = { model: 'gpt-fixture', input: [{ role: 'user', content: [
    image, { type: 'input_text', text: pdf.marker }, { type: 'input_text', text: 'Summarize' },
  ] }] };
  const expected = { model: 'gpt-fixture', input: [{ role: 'user', content: [
    image, { type: 'input_file', filename: pdf.fileName, file_data: `data:application/pdf;base64,${pdf.data}` },
    { type: 'input_text', text: 'Summarize' },
  ] }] };
  const result = injectPdfPayload(payload, 'openai-responses', [pdf]);
  assert.deepEqual(result, expected);
  assert.deepEqual(injectPdfPayload(result, 'openai-responses', [pdf]), expected, 'do not duplicate injected files');
});

test('handles the single-text user message optimization without losing the attachment', () => {
  assert.deepEqual(injectPdfPayload({ input: [{ role: 'user', content: pdf.marker }] }, 'openai-responses', [pdf]),
    { input: [{ role: 'user', content: [{ type: 'input_file', filename: pdf.fileName,
      file_data: `data:application/pdf;base64,${pdf.data}` }] }] });
});

test('never substitutes matching text in system, assistant or tool output', () => {
  const payload = { input: [
    { role: 'system', content: pdf.marker },
    { role: 'assistant', content: [{ type: 'output_text', text: pdf.marker }] },
    { type: 'function_call_output', output: pdf.marker },
  ] };
  assert.deepEqual(injectPdfPayload(payload, 'openai-responses', [pdf]), payload);
});

test('leaves ordinary text/unknown markers untouched and refuses unsupported native PDF protocols', () => {
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Ordinary prompt' }] }] };
  assert.deepEqual(injectPdfPayload(payload, 'openai-completions', []), payload);
  assert.throws(() => injectPdfPayload(payload, 'openai-completions', [pdf]), /unsupported.*PDF|PDF.*unsupported/i);
  const unknown = { input: [{ role: 'user', content: '[nomi-pdf:unknown]' }] };
  assert.deepEqual(injectPdfPayload(unknown, 'openai-responses', [pdf]), unknown);
});

test('preserves multiple files and distinct references to an equal filename', () => {
  const second = { ...pdf, marker: '[nomi-pdf:2]', data: 'JVBERi0xLjc=' };
  const result = injectPdfPayload({ messages: [{ role: 'user', content: [
    { type: 'text', text: second.marker }, { type: 'text', text: pdf.marker },
  ] }] }, 'anthropic-messages', [pdf, second]) as { messages: Array<{ content: Array<{ source: { data: string } }> }> };
  assert.deepEqual(result.messages[0].content.map((c) => c.source.data), [second.data, pdf.data]);
});
