const express = require('express');
const fs = require('fs');
const app = express();

const CONFIG = {
    botToken: "9160866611:AAGgpyyIWPFggf5Mwga5nMOyvoCSA1Ja1ws",
    adminChatId: "7790153616", // Aapki personal Telegram User ID
    apiUrl: "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?ts=1793381099414",
    baseAmount: 10
};

let state = {
    lossCount: 0,
    amount: CONFIG.baseAmount,
    lastProcessedPeriod: null,
    lastPrediction: null,
    strategyMode: 'SIMPLE' // 'SIMPLE' ya 'OPPOSITE'
};

// Configurable Prediction Numbers (Aap inko bot se change kar sakoge)
let predictionConfig = {
    bigNumbers: [2, 7, 8, 9],
    smallNumbers: [3, 5, 0]
};

let history = [];
let sessionsData = {};
let winStickers = [];
let lossStickers = [];
let approvedChats = []; 
let isFetching = false;
let isInitialized = false;
let lastUpdateId = 0;
let stickerMode = null;

const DATA_FILE = './sessions.json';
if (fs.existsSync(DATA_FILE)) {
    try {
        let savedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        sessionsData = savedData.sessions || {};
        winStickers = savedData.winStickers || [];
        lossStickers = savedData.lossStickers || [];
        approvedChats = savedData.approvedChats || [];
        if (savedData.predictionConfig) {
            predictionConfig = savedData.predictionConfig;
        }
    } catch (e) {
        approvedChats = [];
    }
}

function saveDataToFile() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ 
            sessions: sessionsData, 
            winStickers: winStickers, 
            lossStickers: lossStickers,
            approvedChats: approvedChats,
            predictionConfig: predictionConfig
        }, null, 2));
    } catch (e) {}
}

// 🧠 Custom Prediction Logic based on Configurable Numbers
function getCustomPrediction(number) {
    let basePrediction = 'SMALL';
    
    if (predictionConfig.bigNumbers.includes(number)) {
        basePrediction = 'BIG';
    } else if (predictionConfig.smallNumbers.includes(number)) {
        basePrediction = 'SMALL';
    } else {
        basePrediction = 'BIG'; // Default fallback agar number list mein na ho
    }

    let finalPrediction = basePrediction;
    if (state.strategyMode === 'OPPOSITE') {
        finalPrediction = (basePrediction === 'BIG') ? 'SMALL' : 'BIG';
    }

    return finalPrediction;
}

async function sendTgMsg(text, targetChat, replyMarkup = null) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.botToken}/sendMessage`;
        let bodyData = {
            chat_id: targetChat,
            text: text,
            parse_mode: 'Markdown'
        };
        if (replyMarkup) {
            bodyData.reply_markup = replyMarkup;
        }
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
    } catch (e) {}
}

async function broadcastPrediction(text) {
    for (let chatId of approvedChats) {
        await sendTgMsg(text, chatId);
    }
}

async function sendStickerToChat(chatId, isWin) {
    let stickers = isWin ? winStickers : lossStickers;
    if (stickers.length === 0) return;
    let randomSticker = stickers[Math.floor(Math.random() * stickers.length)];
    try {
        const url = `https://api.telegram.org/bot${CONFIG.botToken}/sendSticker`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                sticker: randomSticker
            })
        });
    } catch (e) {}
}

async function broadcastStickers(isWin) {
    for (let chatId of approvedChats) {
        await sendStickerToChat(chatId, isWin);
    }
}

async function sendPhotoMsg(targetChat, photoUrl, caption) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.botToken}/sendPhoto`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: targetChat,
                photo: photoUrl,
                caption: caption,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {}
}

function getCurrentSessionKey() {
    let now = new Date();
    let hours = String(now.getHours()).padStart(2, '0');
    let minutes = now.getMinutes();
    let slotMins = minutes < 30 ? "00-30" : "30-60";
    let dateStr = now.toLocaleDateString();
    return `${dateStr} [${hours}:${slotMins}]`;
}

async function sendSessionStatsToTelegram(targetChat, queryDate = null) {
    let keys = Object.keys(sessionsData);
    if (keys.length === 0) {
        sendTgMsg("⚠️ Abhi tak koi session data log saved nahi hai.", targetChat);
        return;
    }

    let filteredKeys = keys;
    if (!queryDate) {
        let todayStr = new Date().toLocaleDateString();
        filteredKeys = keys.filter(k => k.includes(todayStr));
        if (filteredKeys.length === 0) {
            sendTgMsg("⚠️ Aaj ki date ka abhi tak koi session log record nahi hua hai.", targetChat);
            return;
        }
    } else {
        filteredKeys = keys.filter(k => k.includes(queryDate));
        if (filteredKeys.length === 0) {
            sendTgMsg(`⚠️ "${queryDate}" date ka koi session log nahi mila.`, targetChat);
            return;
        }
    }

    let headerTitle = queryDate ? `📊 *BOT STATS & LOGS (${queryDate})* 📊\n\n` : `📊 *AAJ KA BOT STATS & LOGS* 📊\n\n`;
    let msg = headerTitle;
    
    filteredKeys.forEach((sessionKey) => {
        let s = sessionsData[sessionKey];
        let block = `⏰ *TIME SLOT:* \n🌟 *__${sessionKey}__* 🌟\n` +
                    `✅ Wins: ${s.wins} | ❌ Losses: ${s.losses}\n` +
                    `📈 MAX LOSS STREAK: 🚀 *__Level ${s.maxLevel}__* 🚀\n----------------------------------\n`;

        if ((msg + block).length > 3800) {
            sendTgMsg(msg, targetChat);
            msg = ""; 
        }
        msg += block;
    });

    if (msg.trim().length > 0) {
        sendTgMsg(msg, targetChat);
    }
}

function processNewRound(period, number, incomingType) {
    let actualType = incomingType || (number >= 5 ? 'BIG' : 'SMALL');
    let isWinRound = false;
    let isLossRound = false;

    history.unshift({
        period: period,
        number: number,
        type: actualType
    });
    if (history.length > 100) history.pop();

    let sessionKey = getCurrentSessionKey();
    if (!sessionsData[sessionKey]) {
        sessionsData[sessionKey] = { wins: 0, losses: 0, maxLevel: 0, total: 0 };
    }

    // Win / Loss checking and 2x Martingale Update
    if (state.lastPrediction !== null) {
        let isWin = (state.lastPrediction === actualType);
        sessionsData[sessionKey].total++;

        if (isWin) {
            state.lossCount = 0;
            state.amount = CONFIG.baseAmount;
            state.strategyMode = 'SIMPLE'; 
            isWinRound = true;
            sessionsData[sessionKey].wins++;
        } else {
            state.lossCount++;
            state.amount *= 2; // 2x Martingale Double on Loss
            state.strategyMode = (state.strategyMode === 'SIMPLE') ? 'OPPOSITE' : 'SIMPLE'; 
            isLossRound = true;
            sessionsData[sessionKey].losses++;
            
            if (state.lossCount > sessionsData[sessionKey].maxLevel) {
                sessionsData[sessionKey].maxLevel = state.lossCount;
            }
        }
    }

    saveDataToFile();
    state.lastProcessedPeriod = period;

    let nextPeriod = String(BigInt(period) + 1n);
    let nextPrediction = getCustomPrediction(number);
    let currentBetAmount = state.amount;

    if (isWinRound) {
        broadcastStickers(true);
    } else if (isLossRound) {
        broadcastStickers(false);
    }

    setTimeout(() => {
        let nextMsg = `🚀 *WIN-GO PREDICTION*\n\n` +
                      `📌 *Target Period:* \`${nextPeriod}\`\n` +
                      `🎯 *Strategy:* \`${state.strategyMode}\`\n` +
                      `🔮 *Next Prediction:* *${nextPrediction}*\n` +
                      `💵 *Next Bet:* \`₹${currentBetAmount}\``;
        broadcastPrediction(nextMsg);
    }, 1200);

    state.lastPrediction = nextPrediction;
}

async function fetchLatestResult() {
    if (isFetching) return;
    isFetching = true;

    try {
        const response = await fetch(CONFIG.apiUrl);
        const data = await response.json();
        let listData = data.data?.list || data.data || data.list || [];
        
        if (Array.isArray(listData) && listData.length > 0) {
            if (!isInitialized) {
                history = listData.slice(0, 50).map(item => {
                    let p = String(item.issueNumber || item.period || item.issue || "");
                    let n = parseInt(item.number !== undefined ? item.number : (item.winningNumber !== undefined ? item.winningNumber : item.sum));
                    return { period: p, number: n, type: (n >= 5 ? 'BIG' : 'SMALL') };
                });
                isInitialized = true;
            }

            let latest = listData[0];
            let period = String(latest.issueNumber || latest.period || latest.issue || "");
            let numberVal = latest.number !== undefined ? latest.number : (latest.winningNumber !== undefined ? latest.winningNumber : latest.sum);
            let number = parseInt(numberVal);
            let incomingType = latest.type || (number >= 5 ? 'BIG' : 'SMALL');

            if (period && !isNaN(number) && period !== state.lastProcessedPeriod) {
                processNewRound(period, number, incomingType);
            }
        }
    } catch (e) {} finally {
        isFetching = false;
    }
}

async function pollTelegramCommands() {
    try {
        const res = await fetch(`https://api.telegram.org/bot${CONFIG.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=3`);
        const data = await res.json();
        if (data.ok && data.result) {
            for (let update of data.result) {
                lastUpdateId = update.update_id;
                
                if (update.callback_query) {
                    let callback = update.callback_query;
                    let dataStr = callback.data;
                    let adminId = String(callback.from.id);

                    if (dataStr.startsWith('app_')) {
                        let targetChatId = dataStr.replace('app_', '');
                        if (!approvedChats.includes(targetChatId)) {
                            approvedChats.push(targetChatId);
                            saveDataToFile();
                        }
                        sendTgMsg(`✅ **Approved Successfully!**`, adminId);
                        sendTgMsg(`🎉 **Aapke channel ko approve kar diya gaya hai!**`, targetChatId);
                    } else if (dataStr.startsWith('rej_')) {
                        let targetChatId = dataStr.replace('rej_', '');
                        sendTgMsg(`❌ **Rejected!**`, adminId);
                    }
                    continue;
                }

                let targetChatId = null;
                let chatTitle = "Unknown Chat";
                let senderUsername = "";

                let msgObj = update.message || update.channel_post;
                if (msgObj && msgObj.chat) {
                    targetChatId = String(msgObj.chat.id);
                    chatTitle = msgObj.chat.title || msgObj.chat.first_name || "Channel / Private Chat";
                    senderUsername = msgObj.chat.username ? `@${msgObj.chat.username}` : "No Username";
                }

                if (msgObj && msgObj.text && targetChatId) {
                    let text = msgObj.text.trim();
                    
                    if (text === '/approve') {
                        if (approvedChats.includes(targetChatId)) {
                            sendTgMsg(`ℹ️ Yeh channel pehle se approved hai!`, targetChatId);
                        } else {
                            let reqMsg = `🔔 *NEW APPROVAL REQUEST*\n\n📌 *Name:* ${chatTitle}\n🆔 *ID:* \`${targetChatId}\``;
                            let inlineKeyboard = {
                                inline_keyboard: [
                                    [
                                        { text: "✅ APPROVE", callback_data: `app_${targetChatId}` },
                                        { text: "❌ REJECT", callback_data: `rej_${targetChatId}` }
                                    ]
                                ]
                            };
                            sendTgMsg(reqMsg, CONFIG.adminChatId, inlineKeyboard);
                            sendTgMsg(`⏳ **Request Sent to Admin!**`, targetChatId);
                        }
                    }

                    if (text === '/revoke') {
                        approvedChats = approvedChats.filter(id => id !== targetChatId);
                        saveDataToFile();
                        sendTgMsg(`❌ **Removed from approved list!**`, targetChatId);
                    }

                    // ⚙️ View Current Prediction Config
                    if (text === '/showrules') {
                        let ruleMsg = `📋 *CURRENT PREDICTION RULES*\n\n` +
                                      `🟢 *BIG Numbers:* \`${predictionConfig.bigNumbers.join(', ')}\`\n` +
                                      `🔵 *SMALL Numbers:* \`${predictionConfig.smallNumbers.join(', ')}\`\n\n` +
                                      `🛠 *Commands to Change:*:\n` +
                                      `• \`/addbig <number>\`\n` +
                                      `• \`/rembig <number>\`\n` +
                                      `• \`/addsmall <number>\`\n` +
                                      `• \`/remsmall <number>\``;
                        sendTgMsg(ruleMsg, targetChatId);
                    }

                    // ➕ Add Number to BIG List
                    if (text.startsWith('/addbig')) {
                        let parts = text.split(' ');
                        let num = parseInt(parts[1]);
                        if (!isNaN(num) && num >= 0 && num <= 9) {
                            if (!predictionConfig.bigNumbers.includes(num)) {
                                predictionConfig.bigNumbers.push(num);
                                saveDataToFile();
                                sendTgMsg(`✅ Number **${num}** ko **BIG** list mein add kar diya gaya hai!\nNew BIG: \`${predictionConfig.bigNumbers.join(', ')}\``, targetChatId);
                            } else {
                                sendTgMsg(`⚠️ Number ${num} pehle se BIG list mein hai!`, targetChatId);
                            }
                        } else {
                            sendTgMsg(`⚠️ Sahi format use karein: \`/addbig 4\``, targetChatId);
                        }
                    }

                    // ➖ Remove Number from BIG List
                    if (text.startsWith('/rembig')) {
                        let parts = text.split(' ');
                        let num = parseInt(parts[1]);
                        if (!isNaN(num)) {
                            predictionConfig.bigNumbers = predictionConfig.bigNumbers.filter(n => n !== num);
                            saveDataToFile();
                            sendTgMsg(`✅ Number **${num}** ko BIG list se hata diya gaya hai!\nNew BIG: \`${predictionConfig.bigNumbers.join(', ')}\``, targetChatId);
                        }
                    }

                    // ➕ Add Number to SMALL List
                    if (text.startsWith('/addsmall')) {
                        let parts = text.split(' ');
                        let num = parseInt(parts[1]);
                        if (!isNaN(num) && num >= 0 && num <= 9) {
                            if (!predictionConfig.smallNumbers.includes(num)) {
                                predictionConfig.smallNumbers.push(num);
                                saveDataToFile();
                                sendTgMsg(`✅ Number **${num}** ko **SMALL** list mein add kar diya gaya hai!\nNew SMALL: \`${predictionConfig.smallNumbers.join(', ')}\``, targetChatId);
                            } else {
                                sendTgMsg(`⚠️ Number ${num} pehle se SMALL list mein hai!`, targetChatId);
                            }
                        } else {
                            sendTgMsg(`⚠️ Sahi format use karein: \`/addsmall 4\``, targetChatId);
                        }
                    }

                    // ➖ Remove Number from SMALL List
                    if (text.startsWith('/remsmall')) {
                        let parts = text.split(' ');
                        let num = parseInt(parts[1]);
                        if (!isNaN(num)) {
                            predictionConfig.smallNumbers = predictionConfig.smallNumbers.filter(n => n !== num);
                            saveDataToFile();
                            sendTgMsg(`✅ Number **${num}** ko SMALL list se hata diya gaya hai!\nNew SMALL: \`${predictionConfig.smallNumbers.join(', ')}\``, targetChatId);
                        }
                    }

                    if (text === '/stats') {
                        sendSessionStatsToTelegram(targetChatId);
                    }
                    
                    if (text === '/setwin') {
                        stickerMode = 'win';
                        sendTgMsg(`🟢 Mode activated: Ab jo sticker bhejoge woh **WIN STICKER** banega.`, targetChatId);
                    }
                    
                    if (text === '/setloss') {
                        stickerMode = 'loss';
                        sendTgMsg(`🔴 Mode activated: Ab jo sticker bhejoge woh **LOSS STICKER** banega.`, targetChatId);
                    }

                    if (text === '/resetdata') {
                        sessionsData = {};
                        history = [];
                        state.lossCount = 0;
                        state.amount = CONFIG.baseAmount;
                        state.strategyMode = 'SIMPLE';
                        state.lastPrediction = null;
                        state.lastProcessedPeriod = null;
                        saveDataToFile();
                        sendTgMsg(`🔄 **Saara data reset kar diya gaya hai!**`, targetChatId);
                    }
                }
            }
        }
    } catch (e) {}
}

setInterval(fetchLatestResult, 2000);
setInterval(pollTelegramCommands, 2000);

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.send("Bot is running live on Render with Dynamic Rules & Martingale!");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bot started successfully on port ${PORT}`);
});
