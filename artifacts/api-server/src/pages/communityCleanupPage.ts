export const CLEANUP_PAGE = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shelfmates community cleanup</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, sans-serif; color: #30251f; background: #f9f6f0; }
    body { margin: 0; padding: 24px 16px 48px; }
    main { max-width: 680px; margin: 0 auto; }
    section { background: #fff; border: 1px solid #e8ded3; border-radius: 16px; padding: 20px; margin: 16px 0; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    p { line-height: 1.55; }
    label { display: block; font-weight: 600; margin: 12px 0 6px; }
    input { box-sizing: border-box; width: 100%; border: 1px solid #cfc2b7; border-radius: 9px; padding: 12px; font: inherit; }
    button { border: 0; border-radius: 9px; padding: 12px 16px; margin-top: 14px; font: inherit; font-weight: 700; background: #b85c38; color: white; }
    button:disabled { opacity: .48; }
    button.danger { background: #8b2d22; }
    .muted { color: #62564e; font-size: 14px; }
    .notice { padding: 12px; border-radius: 9px; background: #f5eee6; white-space: pre-wrap; }
    .error { color: #9a2117; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; }
    dt { color: #62564e; } dd { margin: 0; font-weight: 700; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
<main>
  <h1>커뮤니티 기록 정리</h1>
  <p class="muted">관리자 계정으로만 미리보기를 볼 수 있습니다. 이 도구는 사용자 계정, 서재, EPUB, 프로필, 비공개 기록은 삭제하지 않습니다.</p>
  <section>
    <h2>관리자 로그인</h2>
    <form id="loginForm">
      <label for="identifier">사용자 이름</label>
      <input id="identifier" autocomplete="username" value="bookworm">
      <label for="password">비밀번호</label>
      <input id="password" type="password" autocomplete="current-password">
      <button id="login" type="submit">로그인</button>
    </form>
  </section>
  <section id="previewSection" hidden>
    <h2>정리 미리보기</h2>
    <p>보존 계정: <strong>bookworm</strong>, <strong>violet</strong>. 나머지 계정은 유지하고 공개 커뮤니티 기록만 정리합니다.</p>
    <p class="muted">보존 계정의 답글은 부모 댓글이 삭제되면 독립 댓글로 남깁니다. 보존 계정이 참여한 다른 사용자 소유 방은 제한 보관합니다.</p>
    <button id="refresh">최신 미리보기 불러오기</button>
    <div id="summary" class="notice" role="status" aria-live="polite">미리보기를 불러오세요.</div>
    <div id="countsWrap" hidden><dl id="counts"></dl></div>
  </section>
  <section id="applySection" hidden>
    <h2>실행 확인</h2>
    <p class="muted">실행은 별도 설정이 켜져 있을 때만 가능합니다. 현재 미리보기 해시와 정확한 확인 문구가 모두 필요하며, 한 번 성공하면 다시 실행할 수 없습니다.</p>
    <label for="confirmation">확인 문구: DELETE COMMUNITY RECORDS</label>
    <input id="confirmation" autocomplete="off">
    <button id="apply" class="danger" disabled>커뮤니티 기록 정리 실행</button>
  </section>
  <p id="message" class="notice" role="status" aria-live="polite" hidden></p>
</main>
<script>
let token = "";
let snapshotHash = "";
let currentPreview = null;
const $ = (id) => document.getElementById(id);
const message = (text, isError = false) => {
  $("message").textContent = text;
  $("message").className = isError ? "notice error" : "notice";
  $("message").hidden = !text;
};
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login").disabled = true;
  try {
    const data = await request("/api/users/login", {
      method: "POST",
      body: JSON.stringify({ identifier: $("identifier").value.trim(), password: $("password").value }),
    });
    token = data.token;
    $("password").value = "";
    $("previewSection").hidden = false;
    $("applySection").hidden = false;
    message("로그인되었습니다. 최신 미리보기를 불러오세요.");
  } catch (error) {
    message(error.message || "로그인하지 못했습니다.", true);
  } finally {
    $("login").disabled = false;
  }
});
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try {
    currentPreview = await request("/api/admin/community-cleanup/preview");
    snapshotHash = currentPreview.snapshotHash;
    $("summary").textContent = currentPreview.state === "already_applied"
      ? "이미 실행된 1회성 정리입니다. 다시 실행할 수 없습니다."
      : "보존 계정: " + currentPreview.keepUsernames.join(", ") +
        "\\n정리 대상 계정 수: " + currentPreview.targetAccountCount +
        "\\n적용 잠금: " + (currentPreview.applyEnabled ? "해제됨 (다시 확인 후 실행 가능)" : "잠김 (미리보기 전용)") +
        "\\n최신 데이터를 기준으로 계산했습니다.";
    const labels = {
      accountsPreserved: "계정(모두 유지)",
      accountsTargetedForCommunityCleanup: "커뮤니티 기록 정리 대상 계정",
      commentsDeleted: "공개 댓글/답글 삭제",
      retainedRepliesDetached: "보존 계정 답글 분리 후 유지",
      publicHighlightsDeleted: "공개 하이라이트 삭제",
      commentLikesDeleted: "댓글 좋아요 삭제",
      commentSavesDeleted: "댓글 저장 삭제",
      highlightLikesDeleted: "하이라이트 좋아요 삭제",
      friendshipsDeleted: "친구 관계 삭제",
      friendRequestsDeleted: "친구 요청 삭제",
      notificationsDeleted: "관련 알림 삭제",
      roomInvitesDeleted: "방 초대 삭제",
      roomMembershipsDeleted: "방 멤버십 삭제",
      roomsArchived: "제한 보관할 방",
      roomsDeleted: "삭제할 방",
    };
    $("counts").replaceChildren();
    for (const [key, label] of Object.entries(labels)) {
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = label;
      value.textContent = String(currentPreview.counts[key] ?? 0);
      $("counts").append(term, value);
    }
    $("countsWrap").hidden = false;
    $("apply").disabled = currentPreview.state !== "ready" ||
      !currentPreview.applyEnabled ||
      $("confirmation").value !== "DELETE COMMUNITY RECORDS";
    message("미리보기가 갱신되었습니다. 여기서는 운영 데이터가 변경되지 않았습니다.");
  } catch (error) {
    message(error.message || "미리보기를 불러오지 못했습니다.", true);
  } finally {
    $("refresh").disabled = false;
  }
});
$("confirmation").addEventListener("input", () => {
  $("apply").disabled = !currentPreview ||
    currentPreview.state !== "ready" ||
    !currentPreview.applyEnabled ||
    $("confirmation").value !== "DELETE COMMUNITY RECORDS";
});
$("apply").addEventListener("click", async () => {
  if (!currentPreview || $("confirmation").value !== "DELETE COMMUNITY RECORDS") return;
  if (!window.confirm("미리보기의 공개 커뮤니티 기록을 정리할까요? 계정과 비공개 기록은 유지됩니다.")) return;
  $("apply").disabled = true;
  try {
    const result = await request("/api/admin/community-cleanup/apply", {
      method: "POST",
      body: JSON.stringify({ snapshotHash, confirmation: $("confirmation").value }),
    });
    currentPreview = { ...currentPreview, state: "already_applied" };
    $("summary").textContent = "정리가 완료되었습니다. 이 1회성 절차는 다시 실행할 수 없습니다.";
    $("counts").replaceChildren();
    for (const [key, value] of Object.entries(result.counts || {})) {
      const term = document.createElement("dt");
      const count = document.createElement("dd");
      term.textContent = key;
      count.textContent = String(value);
      $("counts").append(term, count);
    }
    $("confirmation").value = "";
    message("완료되었습니다. 계정은 삭제하지 않았습니다.");
  } catch (error) {
    message(error.message || "정리를 완료하지 못했습니다. 최신 미리보기를 다시 확인하세요.", true);
    $("apply").disabled = true;
  }
});
</script>
</body>
</html>`;

