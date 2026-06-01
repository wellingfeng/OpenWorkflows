// Fake `claude` adapter for CLI e2e: read the prompt on stdin, emit claude
// stream-json lines (an assistant text block + a terminal result), exit 0.
let input = '';
process.stdin.on('data', (c) => {
  input += c;
});
process.stdin.on('end', () => {
  const snippet = input.slice(0, 40).replace(/[\r\n]+/g, ' ');
  process.stdout.write(
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'FAKE handled: ' + snippet }] },
    }) + '\n',
  );
  process.stdout.write(
    JSON.stringify({ type: 'result', result: 'FAKE_RESULT[' + snippet + ']' }) + '\n',
  );
});
