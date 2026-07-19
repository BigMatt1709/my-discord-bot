const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    Routes,
    REST,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const fs = require('fs');

// ====== CONFIG ======
const BOT_TOKEN = process.env.TOKEN;
const CLIENT_ID = "1528302952014549052"; // your app ID
const POINTS_FILE = './points.json';
const PREFIX = '!';

// ====== LOAD / SAVE POINTS ======
let points = {};
if (fs.existsSync(POINTS_FILE)) {
    points = JSON.parse(fs.readFileSync(POINTS_FILE, 'utf8'));
}

function savePoints() {
    fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
}

function addPoints(userId, amount) {
    if (!points[userId]) points[userId] = { balance: 0 };
    points[userId].balance += amount;
    savePoints();
}

function getPoints(userId) {
    if (!points[userId]) return 0;
    return points[userId].balance;
}

// ====== TRACK BUTTON CLICKS PER MESSAGE ======
const claimedByMessage = new Map(); 
// key: messageId, value: Set of userIds

// ====== CLIENT ======
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ====== REGISTER SLASH COMMAND ======
const commands = [
    new SlashCommandBuilder()
        .setName('whojoined')
        .setDescription('Show raid participation buttons')
].map(cmd => cmd.toJSON());

// ====== LOGIN ======
client.login(BOT_TOKEN).then(async () => {
    // Register slash commands AFTER login
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
    );

    console.log("Slash command registered.");
});

// ====== BUTTON ROW ======
const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId('joined')
        .setLabel('I Joined')
        .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
        .setCustomId('called')
        .setLabel('I Called')
        .setStyle(ButtonStyle.Primary)
);

// ====== INTERACTIONS ======
client.on('interactionCreate', async interaction => {
    // Slash command
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'whojoined') {
            const msg = await interaction.reply({
                content: '**Raid Participation:**\nChoose your role (one choice only):',
                components: [row],
                fetchReply: true
            });

            // create tracking set for this message
            claimedByMessage.set(msg.id, new Set());
        }
    }

    // Button clicks
    if (interaction.isButton()) {
        const msgId = interaction.message.id;
        const userId = interaction.user.id;

        // check if this message is tracked
        if (!claimedByMessage.has(msgId)) {
            claimedByMessage.set(msgId, new Set());
        }

        const claimedSet = claimedByMessage.get(msgId);

        // if user already clicked any button on this message, block
        if (claimedSet.has(userId)) {
            await interaction.reply({
                content: `You already claimed a role for this raid, <@${userId}>.`,
                ephemeral: true
            });
            return;
        }

        let amount = 0;
        let label = '';

        if (interaction.customId === 'joined') {
            amount = 10;
            label = 'Joined';
        } else if (interaction.customId === 'called') {
            amount = 15;
            label = 'Called';
        }

        // mark user as claimed for this message
        claimedSet.add(userId);

        // add points
        addPoints(userId, amount);

        await interaction.reply({
            content: `You claimed **${label}** and earned **${amount} points**, <@${userId}>!\nYour new balance: **${getPoints(userId)}**`,
            ephemeral: true
        });
    }
});

// ====== MESSAGE COMMANDS (PREFIX !) ======
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    // !balance or !currency
    if (cmd === 'balance' || cmd === 'currency' || cmd === 'wallet') {
        const userId = message.author.id;
        const bal = getPoints(userId);
        await message.reply(`Your balance: **${bal} points**`);
    }

    // !leaderboard
    if (cmd === 'leaderboard' || cmd === 'lb') {
        // sort points
        const entries = Object.entries(points)
            .sort((a, b) => b[1].balance - a[1].balance)
            .slice(0, 10);

        if (entries.length === 0) {
            await message.reply('No one has points yet.');
            return;
        }

        let text = '**Top Points Leaderboard:**\n';
        let rank = 1;
        for (const [userId, data] of entries) {
            text += `\n**${rank}.** <@${userId}> — ${data.balance} points`;
            rank++;
        }

        await message.reply(text);
    }

    // manual admin give: !give @user 15
    if (cmd === 'give') {
        if (!message.member.permissions.has('Administrator')) {
            await message.reply('You must be an admin to use this command.');
            return;
        }

        const target = message.mentions.users.first();
        const amount = parseInt(args[0], 10);

        if (!target || isNaN(amount)) {
            await message.reply('Usage: `!give @user amount`');
            return;
        }

        addPoints(target.id, amount);
        await message.reply(`Gave **${amount} points** to <@${target.id}>. New balance: **${getPoints(target.id)}**`);
    }
});

// ====== WEEKLY RESET ======
function resetWeeklyPoints() {
    for (const userId in points) {
        points[userId].balance = 0;
    }
    savePoints();
    console.log("Weekly points reset.");
}

// Run every 24 hours
setInterval(() => {
    const now = new Date();
    const isSunday = now.getDay() === 0; // Sunday = 0
    const isMidnight = now.getHours() === 0 && now.getMinutes() === 0;

    if (isSunday && isMidnight) {
        resetWeeklyPoints();
    }
}, 60 * 1000); // check every minute
// ====== SHOP ======
const shopItems = {
    "role1": { cost: 50, description: "Special Raid Role" },
    "role2": { cost: 100, description: "Elite Raider Role" },
    "boost": { cost: 25, description: "Temporary XP Boost" }
};

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    // !shop
    if (cmd === "shop") {
        let text = "**🛒 SOS HUB Shop:**\n";
        for (const item in shopItems) {
            const { cost, description } = shopItems[item];
            text += `\n**${item}** — ${cost} points\n*${description}*`;
        }
        return message.reply(text);
    }

    // !buy itemName
    if (cmd === "buy") {
        const itemName = args[0];
        if (!itemName || !shopItems[itemName]) {
            return message.reply("Item not found. Use `!shop` to see available items.");
        }

        const userId = message.author.id;
        const item = shopItems[itemName];

        if (getPoints(userId) < item.cost) {
            return message.reply(`You need **${item.cost} points** to buy **${itemName}**.`);
        }

        // Deduct points
        points[userId].balance -= item.cost;
        savePoints();

        return message.reply(`You bought **${itemName}** for **${item.cost} points**!`);
    }
});
// ====== DASHBOARD ======
const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });

    let html = "<h1>SOS HUB Dashboard</h1>";
    html += "<h2>Leaderboard</h2>";

    const entries = Object.entries(points)
        .sort((a, b) => b[1].balance - a[1].balance)
        .slice(0, 20);

    html += "<ul>";
    for (const [userId, data] of entries) {
        html += `<li>${userId}: ${data.balance} points</li>`;
    }
    html += "</ul>";

    res.end(html);
}).listen(3000, () => {
    console.log("Dashboard running at http://localhost:3000");
});
// ====== DAILY REWARD ======
const dailyRewardAmount = 20;
const dailyClaimsFile = './dailyClaims.json';

let dailyClaims = {};
if (fs.existsSync(dailyClaimsFile)) {
    dailyClaims = JSON.parse(fs.readFileSync(dailyClaimsFile, 'utf8'));
}

function saveDailyClaims() {
    fs.writeFileSync(dailyClaimsFile, JSON.stringify(dailyClaims, null, 2));
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    if (cmd === 'daily') {
        const userId = message.author.id;
        const now = Date.now();

        const lastClaim = dailyClaims[userId] || 0;
        const oneDay = 24 * 60 * 60 * 1000;

        if (now - lastClaim < oneDay) {
            const hoursLeft = Math.ceil((oneDay - (now - lastClaim)) / (60 * 60 * 1000));
            return message.reply(`You already claimed your daily reward. Come back in **${hoursLeft} hours**.`);
        }

        // Give reward
        addPoints(userId, dailyRewardAmount);
        dailyClaims[userId] = now;
        saveDailyClaims();

        return message.reply(`You claimed your **daily reward** of **${dailyRewardAmount} points**!`);
    }
});
