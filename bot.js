const TelegramBot = require("node-telegram-bot-api");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, update, onValue, get, set } = require("firebase/database");
const Jimp = require("jimp");
const QRCodeReader = require("qrcode-reader");

// ======================
// 🔥 إعدادات البوت والفايربيس
// ======================
const BOT_TOKEN = "8979342176:AAGmKAyuV1UgErEyJ46dAVk6rs3dFy_vf0g";
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const firebaseConfig = {
  apiKey: "AIzaSyCx0EyZBf_51aYfeTQL_OaHy5x7nq3-wPA",
  authDomain: "topupsystem-167cc.firebaseapp.com",
  databaseURL: "https://topupsystem-167cc-default-rtdb.firebaseio.com",
  projectId: "topupsystem-167cc",
  storageBucket: "topupsystem-167cc.firebasestorage.app",
  messagingSenderId: "490271530687",
  appId: "1:490271530687:web:5059cb9499cd095e04700a"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ADMIN_CHAT_ID = 8824842635;
const PASSWORD = "92.Ne_zo.50";

let waitingForPin = {};
let waitingForPassword = new Set();
const sentOrders = new Set();

// التحقق من التصريح
async function isAuthorized(chatId) {
    const snapshot = await get(ref(db, "authorizedUsers/" + chatId));
    return snapshot.exists();
}

// ======================
// 📷 قراءة QR Code من الصور
// ======================
async function readQRFromImage(imageBuffer) {
    return new Promise((resolve, reject) => {
        try {
            Jimp.read(imageBuffer, (err, image) => {
                if (err) {
                    reject("❌ فشل قراءة الصورة");
                    return;
                }

                const qr = new QRCodeReader();
                qr.callback = (err, value) => {
                    if (err) {
                        reject("❌ لم يتم العثور على كود QR");
                        return;
                    }
                    if (value && value.result) {
                        resolve(value.result);
                    } else {
                        reject("❌ لم يتم العثور على كود QR");
                    }
                };

                qr.decode(image.bitmap);
            });
        } catch (error) {
            reject("❌ حدث خطأ أثناء معالجة الصورة");
        }
    });
}

// ======================
// 🔑 أمر البدء (Start)
// ======================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    if (await isAuthorized(chatId)) {
        bot.sendMessage(chatId, "✅ أهلاً بك، البوت جاهز للاستخدام.\n📷 أرسل صورة تحتوي على كود QR لقراءتها.");
    } else {
        waitingForPassword.add(chatId);
        bot.sendMessage(chatId, "🔐 يرجى إدخال كلمة السر لتفعيل البوت:");
    }
});

// ======================
// 📸 معالجة الصور (QR Code)
// ======================
bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    
    // التحقق من التصريح
    if (!(await isAuthorized(chatId))) {
        return bot.sendMessage(chatId, "⚠️ يجب تفعيل البوت أولاً عبر /start");
    }

    try {
        // اختيار أعلى جودة للصورة
        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);
        
        // تحميل الصورة
        const response = await fetch(fileLink);
        const imageBuffer = await response.arrayBuffer();

        // قراءة QR Code
        const qrResult = await readQRFromImage(Buffer.from(imageBuffer));
        
        // الرد بالنتيجة
        await bot.sendMessage(chatId, `✅ تم قراءة QR Code بنجاح!\n\n📝 النص المستخرج:\n${qrResult}`);
        
    } catch (error) {
        if (error.includes("لم يتم العثور على كود QR")) {
            await bot.sendMessage(chatId, "❌ لم يتم العثور على كود QR في هذه الصورة.");
        } else {
            console.error("Error reading QR:", error);
            await bot.sendMessage(chatId, "❌ حدث خطأ أثناء معالجة الصورة.");
        }
    }
});

// ======================
// 🔥 استقبال الرسائل النصية
// ======================
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // تجاهل الرسائل التي تحتوي على صور (تم معالجتها في bot.on("photo"))
    if (msg.photo) return;

    // 1. معالجة كلمة السر
    if (waitingForPassword.has(chatId)) {
        if (text === PASSWORD) {
            await set(ref(db, "authorizedUsers/" + chatId), true);
            waitingForPassword.delete(chatId);
            return bot.sendMessage(chatId, "✅ تم تفعيل البوت بنجاح! لن يطلب منك كلمة السر مجدداً.");
        } else {
            return bot.sendMessage(chatId, "❌ كلمة سر خاطئة.");
        }
    }

    // 2. التحقق من التصريح
    if (!(await isAuthorized(chatId))) return;

    // 3. معالجة الـ PIN
    if (!text || text.startsWith("/") || !waitingForPin[chatId]) return;
    const orderNumber = waitingForPin[chatId];
    if (!/^[0-9]+$/.test(text)) return bot.sendMessage(chatId, "❌ PIN يجب أن يتكون من أرقام فقط");

    try {
        const snapshot = await get(ref(db, "orders"));
        const data = snapshot.val();
        let targetKey = null, targetOrder = null;
        for (let key in data) {
            if (String(data[key].orderNumber) === String(orderNumber)) {
                targetKey = key; targetOrder = data[key]; break;
            }
        }
        if (targetKey && targetOrder) {
            await update(ref(db, "orders/" + targetKey), { pin: text, status: "done", completedAt: Date.now() });
            if (targetOrder.messageId) bot.deleteMessage(ADMIN_CHAT_ID, targetOrder.messageId).catch(console.error);
            bot.sendMessage(chatId, `✅ تم شحن الطلب بنجاح\n\n👤 الاسم: ${targetOrder.name}\n📦 المنتج: ${targetOrder.product}\n🔢 رقم الطلب: ${targetOrder.orderNumber}\n🔑 PIN: ${text}`);
            delete waitingForPin[chatId];
        }
    } catch (err) { bot.sendMessage(chatId, "❌ فشل تحديث الطلب"); }
});

// ======================
// 🔘 الضغط على الأزرار
// ======================
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (!(await isAuthorized(chatId))) return bot.answerCallbackQuery(query.id, { text: "⚠️ يجب تسجيل الدخول أولاً!" });
    
    const data = query.data;
    bot.answerCallbackQuery(query.id);
    if (data.startsWith("pin_")) {
        const orderNumber = data.replace("pin_", "");
        waitingForPin[chatId] = orderNumber;
        bot.sendMessage(chatId, `✏️ أرسل PIN للطلب: ${orderNumber}`);
    }
});

// ======================
// 📦 مراقبة الطلبات
// ======================
onValue(ref(db, "orders"), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;
  for (let id in data) {
    const order = data[id];
    if (order.status === "waiting" && !sentOrders.has(order.orderNumber)) {
      sentOrders.add(order.orderNumber);
      bot.sendMessage(ADMIN_CHAT_ID, `📦 طلب جديد\n\n👤 الاسم: ${order.name}\n📦 المنتج: ${order.product}\n🔢 رقم الطلب: ${order.orderNumber}\n💰 السعر: ${order.price} د.ع`, {
        reply_markup: { inline_keyboard: [[{ text: "✏️ إرسال PIN", callback_data: "pin_" + order.orderNumber }]] }
      }).then((sentMsg) => { update(ref(db, "orders/" + id), { messageId: sentMsg.message_id }); });
    }
  }
});

console.log("🚀 البوت شغال...");