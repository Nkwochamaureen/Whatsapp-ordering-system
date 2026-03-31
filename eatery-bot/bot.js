require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Put your free Google Gemini API Key here
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. Put the Kitchen's WhatsApp Number here (include country code, e.g., 234 for Nigeria, no '+')
const KITCHEN_NUMBER = "234XXXXXXXXXX@c.us"; 

// This acts as our free database to remember who placed the order
let pendingOrders = {}; 

// Initialize WhatsApp Client with Anti-Crash and Stable Version arguments
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // You can change this to 'false' if you want to see the browser open
        args:[
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    },
    // ADDING THIS: Forces the bot to use a stable version of WhatsApp Web
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', (qr) => {
    // Generates a QR code in your terminal to scan with your phone
    qrcode.generate(qr, { small: true });
    console.log("Scan this QR code with the Eatery's WhatsApp!");
});

client.on('ready', () => {
    console.log('Zero-Budget AI Bot is Ready and Listening!');
});

client.on('message', async msg => {
    const sender = msg.from;

    // --- KITCHEN CONFIRMATION LOGIC ---
    // If the message is from the kitchen and they reply "YES"
    if (sender === KITCHEN_NUMBER && msg.body.toUpperCase().includes("YES")) {
        // Find the oldest pending order
        const userToConfirm = Object.keys(pendingOrders)[0]; 
        if (userToConfirm) {
            // Send confirmation to the customer
            client.sendMessage(userToConfirm, "✅ *Great news!* The kitchen has confirmed your receipt. Your order is being processed now!");
            delete pendingOrders[userToConfirm]; // Remove from pending
            client.sendMessage(KITCHEN_NUMBER, "Customer notified!");
        } else {
            client.sendMessage(KITCHEN_NUMBER, "No pending orders to confirm.");
        }
        // IGNORE STATUS UPDATES (Prevents the bot from replying to or posting statuses)
    if (msg.isStatus || sender === 'status@broadcast') {
        return; 
    }

    // IGNORE GROUPS (Optional, but highly recommended so it doesn't reply to group chats)
    if (sender.includes('@g.us')) {
        return;
    }
        return;
    }

    // --- CUSTOMER RECEIPT/FLYER LOGIC ---
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        
        if (media.mimetype.includes("image")) {
            client.sendMessage(sender, "Scanning your receipt/flyer... please wait ⏳");

            try {
                // Prepare image for Google Gemini AI
                const generativePart = {
                    inlineData: { data: media.data, mimeType: media.mimetype },
                };

                // Ask the free AI to act as an agent
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const prompt = `
                You are a smart assistant for an eatery. Look at this image (receipt or promo flyer).
                1. Find the date on it.
                2. Today's date is ${new Date().toDateString()}.
                3. If the date matches today, or if it's a general flyer with no expiration, reply EXACTLY with "VALID" followed by the food items ordered.
                4. If the date is old/expired, reply EXACTLY with "INVALID".
                `;

                const result = await model.generateContent([prompt, generativePart]);
                const aiResponse = result.response.text();

                if (aiResponse.includes("INVALID")) {
                    client.sendMessage(sender, "❌ Sorry, this receipt or flyer appears to be expired, old, or invalid. Please check and send a current one.");
                } else if (aiResponse.includes("VALID")) {
                    // Extract the food items (everything after the word VALID)
                    const orderDetails = aiResponse.replace("VALID", "").trim();
                    
                    // Save the user in our free temporary memory
                    pendingOrders[sender] = orderDetails;

                    // Send to Kitchen
                    const kitchenMsg = `*🚨 NEW ORDER ALERT!*\n\n*Details:* ${orderDetails}\n\n*Reply "YES" to confirm this order.*`;
                    client.sendMessage(KITCHEN_NUMBER, kitchenMsg);

                    // Tell the customer we are waiting for the kitchen
                    client.sendMessage(sender, "✅ Receipt valid! I have sent your order to the kitchen. Waiting for the Chef's confirmation...");
                }

            } catch (error) {
                console.error("AI Error:", error);
                client.sendMessage(sender, "Sorry, I had trouble reading that image. A human agent will be with you shortly.");
            }
        }
    }
});

client.initialize();