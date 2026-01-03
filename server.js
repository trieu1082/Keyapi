const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, "db.json");

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = {
      key: "PMT-KEY-123",
      getKeyLink: "https://your-getkey-link.example",
      successCount: 0,
      users: [] // { name, userId, timeISO, ip }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), "utf8");
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// ✅ đổi cái này thành chuỗi dài khó đoán
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "CHANGE_ME_ADMIN_TOKEN";

// CORS đơn giản (cho Roblox/website gọi)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ===== Public endpoints =====

// trả về link get key hiện tại (script có thể hiển thị cho người dùng)
app.get("/getkey", (req, res) => {
  const db = loadDB();
  res.json({ ok: true, getKeyLink: db.getKeyLink });
});

// verify key: /verify?key=...&user=...&userId=...
app.get("/verify", (req, res) => {
  const db = loadDB();

  const key = String(req.query.key || "");
  const name = String(req.query.user || "Unknown");
  const userId = Number(req.query.userId || 0);

  if (!key) return res.status(400).json({ ok: false, error: "missing_key" });

  const ok = key === db.key;

  if (ok) {
    db.successCount += 1;

    // lưu log người nhập đúng (có thể trùng tên nhiều lần -> vẫn ghi)
    db.users.unshift({
      name,
      userId,
      timeISO: new Date().toISOString(),
      ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || ""
    });

    // giới hạn log để khỏi phình
    db.users = db.users.slice(0, 500);
    saveDB(db);
  }

  res.json({
    ok,
    successCount: db.successCount
  });
});

// ===== Admin endpoints (cần token) =====
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

// xem stats
app.get("/admin/stats", requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    key: db.key,
    getKeyLink: db.getKeyLink,
    successCount: db.successCount,
    users: db.users
  });
});

// set key + link
app.post("/admin/config", requireAdmin, (req, res) => {
  const db = loadDB();
  const { key, getKeyLink } = req.body || {};

  if (typeof key === "string" && key.trim().length > 0) db.key = key.trim();
  if (typeof getKeyLink === "string" && getKeyLink.trim().length > 0) db.getKeyLink = getKeyLink.trim();

  saveDB(db);
  res.json({ ok: true, key: db.key, getKeyLink: db.getKeyLink });
});

// reset stats (tuỳ chọn)
app.post("/admin/reset", requireAdmin, (req, res) => {
  const db = loadDB();
  db.successCount = 0;
  db.users = [];
  saveDB(db);
  res.json({ ok: true });
});

// ===== Admin page =====
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Key Admin</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial;margin:20px;max-width:1000px}
  input,textarea{width:100%;padding:10px;margin:6px 0;border:1px solid #ccc;border-radius:10px}
  button{padding:10px 14px;border:0;border-radius:10px;cursor:pointer}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .card{border:1px solid #ddd;border-radius:14px;padding:14px;margin:10px 0}
  table{width:100%;border-collapse:collapse}
  th,td{border-bottom:1px solid #eee;padding:8px;text-align:left;font-size:14px}
  .muted{opacity:.7}
  code{background:#f3f3f3;padding:2px 6px;border-radius:8px}
</style>
</head>
<body>
  <h2>Key Admin</h2>
  <p class="muted">Nhập <b>Admin Token</b> rồi bấm Load để xem & chỉnh.</p>

  <div class="card">
    <label>Admin Token</label>
    <input id="token" placeholder="X-Admin-Token"/>
    <button onclick="loadStats()">Load</button>
  </div>

  <div class="card">
    <h3>Cấu hình</h3>
    <label>Key hiện tại</label>
    <input id="key" placeholder="Key..."/>

    <label>Link get key</label>
    <input id="link" placeholder="https://..."/>

    <button onclick="saveConfig()">Save Config</button>
    <button onclick="resetAll()" style="margin-left:8px">Reset Stats</button>
    <p class="muted">Public endpoints: <code>/getkey</code> và <code>/verify?key=...&user=...&userId=...</code></p>
  </div>

  <div class="card">
    <h3>Thống kê</h3>
    <div>Success Count: <b id="count">-</b></div>
  </div>

  <div class="card">
    <h3>Người nhập đúng (mới nhất)</h3>
    <table>
      <thead>
        <tr><th>Tên</th><th>UserId</th><th>Time (UTC)</th><th>IP</th></tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

<script>
async function loadStats(){
  const token = document.getElementById("token").value.trim();
  const res = await fetch("/admin/stats", { headers: { "X-Admin-Token": token }});
  const data = await res.json();
  if(!data.ok){ alert("Unauthorized hoặc lỗi!"); return; }
  document.getElementById("key").value = data.key;
  document.getElementById("link").value = data.getKeyLink;
  document.getElementById("count").textContent = data.successCount;

  const tb = document.getElementById("tbody");
  tb.innerHTML = "";
  for(const u of data.users){
    const tr = document.createElement("tr");
    tr.innerHTML = "<td>"+escapeHtml(u.name)+"</td><td>"+u.userId+"</td><td>"+u.timeISO+"</td><td>"+escapeHtml(u.ip||"")+"</td>";
    tb.appendChild(tr);
  }
}

async function saveConfig(){
  const token = document.getElementById("token").value.trim();
  const key = document.getElementById("key").value.trim();
  const link = document.getElementById("link").value.trim();
  const res = await fetch("/admin/config", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "X-Admin-Token": token },
    body: JSON.stringify({ key, getKeyLink: link })
  });
  const data = await res.json();
  if(!data.ok){ alert("Save thất bại!"); return; }
  alert("Đã lưu!");
  loadStats();
}

async function resetAll(){
  const token = document.getElementById("token").value.trim();
  const res = await fetch("/admin/reset", {
    method:"POST",
    headers:{ "X-Admin-Token": token }
  });
  const data = await res.json();
  if(!data.ok){ alert("Reset thất bại!"); return; }
  alert("Đã reset!");
  loadStats();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
</script>

</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Key API running on port", PORT));
