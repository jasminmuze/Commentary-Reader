const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

test("room invitations retain book details, repair old cover paths and allow images", async () => {
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, "serve.js")], {
    env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
    stdio: "ignore",
  });
  const host = "shelfmates.example";
  const legacyCover = `https://${host}/catalog-covers?url=${encodeURIComponent(
    "https://covers.openlibrary.org/b/id/8361789-L.jpg?default=false",
  )}`;
  const params = new URLSearchParams({
    roomName: "Read together",
    bookTitle: "The Cruel Prince",
    bookAuthor: "Holly Black",
    coverUrl: legacyCover,
    join: "1",
  });
  const request = () => fetch(`http://127.0.0.1:${port}/room/77?${params}`, {
    headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
  });

  try {
    let response;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        response = await request();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert(response, "invite server did not start");
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /img-src 'self' https:\/\/covers\.openlibrary\.org/);
    const html = await response.text();
    const data = JSON.parse(html.match(/const invite = ([^\n]+);/)[1]);
    assert.equal(data.bookTitle, "The Cruel Prince");
    assert.equal(data.bookAuthor, "Holly Black");
    assert.equal(new URL(data.coverUrl).pathname, "/api/catalog-covers");
    assert.match(html, /og:image" content="https:\/\/shelfmates\.example\/api\/catalog-covers/);
    assert.match(html, /Read The Cruel Prince together on Shelfmates/);

    params.set("coverUrl", "https://untrusted.example/image.jpg");
    const unsafeHtml = await (await request()).text();
    const unsafeData = JSON.parse(unsafeHtml.match(/const invite = ([^\n]+);/)[1]);
    assert.equal(unsafeData.coverUrl, "");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});
