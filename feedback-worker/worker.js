/*
 * Отзывы из игры → Telegram-группа, и журнал группы для чтения.
 *
 * Зачем прослойка: игра лежит в открытом репозитории, и токен бота,
 * вшитый в страницу, утащат за минуту — после чего от имени бота можно
 * писать куда угодно. Поэтому страница отправляет отзыв сюда, а токен
 * живёт только в секретах Cloudflare и наружу не выходит.
 *
 * Адреса:
 *   POST /           отзыв из игры → сообщение в группу
 *   POST /telegram   вебхук: Telegram присылает сюда сообщения группы
 *   GET  /messages   журнал группы, новые сверху (нужен ключ чтения)
 *   GET  /setup      подключить вебхук у бота (нужен ключ чтения)
 *
 * Бот не получает обратно собственные сообщения, поэтому отзывы
 * записываются в журнал в момент отправки, а сообщения людей — из вебхука.
 *
 * Настройки (Cloudflare → Worker → Settings):
 *   BOT_TOKEN       секрет   токен от @BotFather
 *   CHAT_ID         текст    id группы: -5554322664 или -1001234567890
 *   READ_KEY        секрет   ключ для /messages и /setup, им же Telegram
 *                            подписывает вебхук; только A-Z a-z 0-9 _ -
 *   MESSAGES        KV       привязка хранилища для журнала
 *   TOPIC_ID        текст    необязательно: id темы, если в группе включены темы
 *   ALLOWED_ORIGIN  текст    необязательно: откуда разрешено слать отзывы,
 *                            по умолчанию https://uwolfson.github.io
 *
 * Без READ_KEY и MESSAGES отзывы по-прежнему уходят, просто журнала нет.
 */

const MAX_TEXT = 2000;
const KEEP_SECONDS = 365 * 24 * 3600;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/telegram") return fromTelegram(request, env);
    if (path === "/messages") return listMessages(request, env);
    if (path === "/setup") return setup(request, env);
    return fromGame(request, env);
  },
};

async function fromGame(request, env) {
  const allowed = env.ALLOWED_ORIGIN || "https://uwolfson.github.io";
  const origin = request.headers.get("Origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return reply("Только POST", 405, cors);

  // Заголовок Origin подделывается скриптом, так что это не защита от
  // целенаправленной атаки, а фильтр от случайного мусора. Для прототипа
  // с закрытым кругом тестировщиков этого достаточно.
  if (origin !== allowed) return reply("Чужой источник", 403, cors);

  let data;
  try {
    data = await request.json();
  } catch {
    return reply("Ожидался JSON", 400, cors);
  }

  // Ловушка для ботов: поле, которое человек не видит и не заполняет
  if (data.website) return reply("ok", 200, cors);

  const text = clean(data.text, MAX_TEXT);
  if (!text) return reply("Пустой отзыв", 400, cors);

  const lines = [
    "📝 Отзыв из игры",
    "",
    text,
    "",
    data.age ? "Возраст ребёнка: " + clean(data.age, 40) : null,
    "Режим: " + clean(data.mode, 20) +
      " · стиль: " + clean(data.style, 20) +
      " · в коллекции: " + clean(String(data.collected ?? ""), 6),
    "Устройство: " + clean(data.device, 160),
    "Версия: " + clean(data.version, 40),
  ].filter(Boolean);

  const message = {
    chat_id: env.CHAT_ID,
    text: lines.join("\n"),
    disable_web_page_preview: true,
    // без parse_mode: текст уходит как есть, разметку из отзыва не исполняем
  };
  if (env.TOPIC_ID) message.message_thread_id = Number(env.TOPIC_ID);

  const tg = await telegram(env, "sendMessage", message);
  if (!tg.ok) {
    // Текст ошибки Telegram в ответ не отдаём: в нём может оказаться
    // что-то о настройках бота. Смотреть — в логах воркера.
    console.log("Telegram:", tg.status, JSON.stringify(tg.body));
    return reply("Не удалось отправить в Telegram", 502, cors);
  }

  const sent = tg.body.result;
  await remember(env, {
    id: sent.message_id,
    date: sent.date,
    from: "бот",
    kind: "feedback",
    text: message.text,
  });
  return reply("ok", 200, cors);
}

async function fromTelegram(request, env) {
  // Telegram кладёт в этот заголовок secret_token, заданный в /setup
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.READ_KEY || secret !== env.READ_KEY) return reply("Нет доступа", 403);

  let update;
  try {
    update = await request.json();
  } catch {
    return reply("ok", 200);
  }

  const msg = update.message || update.edited_message;
  if (!msg || String(msg.chat.id) !== String(env.CHAT_ID)) return reply("ok", 200);

  // Группа, ставшая супергруппой, получает новый id — CHAT_ID надо сменить
  if (msg.migrate_to_chat_id) {
    console.log("Группа сменила id на", msg.migrate_to_chat_id, "— обновите CHAT_ID");
  }

  const u = msg.from || {};
  await remember(env, {
    id: msg.message_id,
    date: msg.date,
    from: [u.first_name, u.last_name].filter(Boolean).join(" ") ||
      u.username || "?",
    kind: update.edited_message ? "edited" : "message",
    text: msg.text || msg.caption || describe(msg),
    reply_to: msg.reply_to_message ? msg.reply_to_message.message_id : undefined,
  });
  return reply("ok", 200);
}

async function listMessages(request, env) {
  if (!authorized(request, env)) return reply("Нет доступа", 403);
  if (!env.MESSAGES) return reply("Хранилище MESSAGES не привязано", 500);

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 500);
  const list = await env.MESSAGES.list({ prefix: "m:", limit });
  const items = await Promise.all(
    list.keys.map((k) => env.MESSAGES.get(k.name, "json"))
  );
  return json(items.filter(Boolean));
}

async function setup(request, env) {
  if (!authorized(request, env)) return reply("Нет доступа", 403);
  const hook = new URL("/telegram", request.url).href;
  const tg = await telegram(env, "setWebhook", {
    url: hook,
    secret_token: env.READ_KEY,
    allowed_updates: ["message", "edited_message"],
  });
  const info = await telegram(env, "getWebhookInfo", {});
  return json({ setWebhook: tg.body, webhook: info.body.result });
}

// Ключи идут от новых к старым: KV отдаёт их по алфавиту
async function remember(env, record) {
  if (!env.MESSAGES) return;
  const key = "m:" + String(9999999999 - record.date).padStart(10, "0") +
    ":" + record.id + (record.kind === "edited" ? ":e" : "");
  await env.MESSAGES.put(key, JSON.stringify(record), { expirationTtl: KEEP_SECONDS });
}

async function telegram(env, method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { ok: r.ok, status: r.status, body };
}

function authorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return Boolean(env.READ_KEY) && auth === "Bearer " + env.READ_KEY;
}

function describe(msg) {
  const kinds = ["photo", "video", "voice", "audio", "document", "sticker",
    "animation", "video_note", "new_chat_members", "left_chat_member"];
  const kind = kinds.find((k) => msg[k]);
  return "[" + (kind || "служебное") + "]";
}

function clean(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function json(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function reply(body, status, headers) {
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}
