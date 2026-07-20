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
// ====== COOLDOWN MAP ======
const cooldowns = new Map();
let whoJoinedCooldown = 0; // timestamp of last use

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
// ====== ROLE + SERVER-WIDE COOLDOWN ======
const allowedRoleId = "1515606449332424749"; // replace with your real role ID
const cooldownTime = 3 * 60 * 1000; // 3 minutes

// Logging channel (optional)
const logChannelId = "1528652282252496926"; // replace with your logging channel ID

// ROLE CHECK
if (!interaction.member.roles.cache.has(allowedRoleId)) {
    // Log unauthorized attempt
    const logChannel = interaction.guild.channels.cache.get(logChannelId);
    if (logChannel) {
        logChannel.send(`❌ <@${interaction.user.id}> tried to use /whojoined but lacks the required role.`);
    }

    return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true
    });
}

// SERVER-WIDE COOLDOWN CHECK
const now = Date.now();
if (now - whoJoinedCooldown < cooldownTime) {
    const remaining = Math.ceil((cooldownTime - (now - whoJoinedCooldown)) / 1000);

    // Log cooldown block
    const logChannel = interaction.guild.channels.cache.get(logChannelId);
    if (logChannel) {
        logChannel.send(`⏳ <@${interaction.user.id}> tried to use /whojoined but cooldown is active (${remaining}s left).`);
    }

    return interaction.reply({
        content: `Slowmode active. You can use this command again in **${remaining} seconds**.`,
        ephemeral: true
    });
}

// SET NEW SERVER-WIDE COOLDOWN
whoJoinedCooldown = now;

// Log successful use
const logChannel = interaction.guild.channels.cache.get(logChannelId);
if (logChannel) {
    logChannel.send(`✅ <@${interaction.user.id}> used /whojoined successfully.`);
}
const msg = await interaction.reply({
    content: '**Raid Participation:**\nChoose your role (one choice only):',
    components: [row],
    ephemeral: false
});

// Track button claims for this message
claimedByMessage.set(msg.id, new Set());

// Auto-delete raid message after 10 minutes
setTimeout(() => {
    msg.delete().catch(() => {});
}, 10 * 60 * 1000);

        }   // closes: if (interaction.commandName === 'whojoined')
    }       // closes: if (interaction.isChatInputCommand())

    // Button clicks
    if (interaction.isButton()) {

        const msgId = interaction.message.id;
        const userId = interaction.user.id;

        // check if this message is tracked
        if (!claimedByMessage.has(msgId)) {
            claimedByMessage.set(msgId, new Set());
        }

        const claimedSet = claimedByMessage.get(msgId);
// Initialize per-message "called" flag
if (claimedSet.called === undefined) {
    claimedSet.called = false;
}
// Track who called for this message
if (claimedSet.callerName === undefined) {
    claimedSet.callerName = null;
}




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

    // ====== ONLY ONE PERSON CAN CLAIM "I CALLED" PER MESSAGE ======
    if (claimedSet.called) {
        return interaction.reply({
            content: `Someone has already claimed **I Called** for this raid.\nCaller: <@${claimedSet.callerName}>`,
            ephemeral: true
        });
    }

    // Mark "I Called" as claimed for THIS message only
    claimedSet.called = true;
    claimedSet.callerName = userId;

    amount = 15;
    label = 'Called';

    // ====== EDIT ORIGINAL MESSAGE TO SHOW CALLER ======
    const originalMessage = interaction.message;

    await originalMessage.edit({
        content: `**Raid Participation:**\nChoose your role (one choice only):\n\n📣 **Caller:** <@${userId}>`,
        components: [row]
    });
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