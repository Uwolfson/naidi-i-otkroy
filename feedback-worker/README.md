# Отзывы из игры → Telegram

Маленький воркер Cloudflare: игра отправляет отзыв сюда, воркер отправляет
его в группу от имени бота. Токен бота лежит только в секретах Cloudflare и
в открытый репозиторий не попадает.

Бесплатного тарифа Cloudflare хватает с огромным запасом: 100 000 запросов
в сутки. Ставить ничего не нужно, всё делается в браузере.

## Развернуть — около пяти минут

1. Войти на [dash.cloudflare.com](https://dash.cloudflare.com) (или
   зарегистрироваться, это бесплатно).
2. **Workers & Pages → Create → Create Worker.** Назвать, например,
   `naidi-feedback` → **Deploy**.
3. **Edit code** → стереть всё, вставить содержимое [`worker.js`](worker.js)
   → **Deploy**.
4. **Settings → Variables and Secrets → Add**:

   | Имя | Тип | Значение |
   |---|---|---|
   | `BOT_TOKEN` | **Secret** | токен от @BotFather |
   | `CHAT_ID` | Text | id группы, вида `-1001234567890` |
   | `TOPIC_ID` | Text | необязательно: id темы для отзывов |

   `BOT_TOKEN` обязательно типа **Secret** — тогда его не видно даже в
   панели после сохранения.
5. Скопировать адрес воркера (вида `https://naidi-feedback.<имя>.workers.dev`)
   и вписать его в игру, в константу `FEEDBACK_ENDPOINT`. Адрес не секрет.

## Где взять `CHAT_ID`

Открыть группу в [Telegram Web](https://web.telegram.org/a/): число в адресной
строке после `#` — это и есть id, вместе со знаком минус, например
`-1001234567890`.

Если в группе включены темы, `TOPIC_ID` — число после id группы и
подчёркивания в адресе открытой темы: в `#-1001234567890_15` это `15`.

## Проверить

Открыть игру → удержать шестерёнку → написать тестовый отзыв → «Отправить».
Сообщение должно появиться в группе в течение пары секунд. Если нет —
**Worker → Logs**: там будет ответ Telegram.

Типичные причины:

- **`chat not found`** — неверный `CHAT_ID` или бота нет в группе.
- **`Unauthorized`** — неверный `BOT_TOKEN`.
- **`message thread not found`** — неверный `TOPIC_ID` или темы в группе выключены.

## Журнал группы: читать отзывы и ответы

Воркер складывает в хранилище KV всё, что видит в группе: отзывы, которые
отправил сам (бот не получает обратно свои сообщения), и сообщения людей,
которые Telegram присылает на вебхук `/telegram`.

Настройка:

1. **Storage & databases → KV → Create** → `naidi-feedback-messages`.
2. Воркер → **Bindings → Add binding → KV namespace**: имя `MESSAGES`,
   хранилище `naidi-feedback-messages`.
3. **Settings → Variables and Secrets**: `READ_KEY`, тип **Secret**, любая
   длинная строка из `A-Z a-z 0-9 _ -`. Локальная копия лежит в
   `feedback-worker/.read-key`, файл в `.gitignore`.
4. Подключить вебхук:

   ```bash
   curl -H "Authorization: Bearer $(cat feedback-worker/.read-key)" https://naidi-feedback.wolfson-u.workers.dev/setup
   ```

5. Чтобы бот видел сообщения людей, а не только команды: в @BotFather
   `/setprivacy` → бот → **Disable**, потом удалить бота из группы и
   добавить заново. Либо просто сделать бота администратором группы.

Читать:

```bash
curl -H "Authorization: Bearer $(cat feedback-worker/.read-key)" "https://naidi-feedback.wolfson-u.workers.dev/messages?limit=50"
```

Новые сверху, хранятся год. После `/setup` бот больше не отдаёт сообщения
через `getUpdates`: у бота может быть либо вебхук, либо опрос.
