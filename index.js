require('dotenv').config()
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    Routes,
    REST,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const http = require('http');

// ====== COOLDOWN MAP ======
const cooldowns = new Map();
let whoJoinedCooldown = 0;
let whoRaidedCooldown = 0;
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

function removePoints(userId, amount) {
    if (!points[userId]) points[userId] = { balance: 0 };
    points[userId].balance -= amount;
    if (points[userId].balance < 0) points[userId].balance = 0;
    savePoints();
}

function getPoints(userId) {
    if (!points[userId]) return 0;
    return points[userId].balance;
}

// ====== TRACK BUTTON CLICKS PER MESSAGE ======
const claimedByMessage = new Map(); 
// key: messageId, value: Set of userIds + flags

// ====== CLIENT ======
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ====== GIVEAWAY SYSTEM ======
client.giveaway = {
    active: false,
    entries: {},
    timeout: null,
    channel: null
};

function endGiveaway(targetChannel) {
    const g = client.giveaway;

    if (!g || !g.active) {
        if (targetChannel) {
            return targetChannel.send("No giveaway is active.");
        }
        return;
    }

    g.active = false;
    clearTimeout(g.timeout);

    const entries = Object.entries(g.entries);

    if (entries.length === 0) {
        return targetChannel.send("Giveaway ended — no entries.");
    }

    const weighted = [];
    entries.forEach(([userId, amount]) => {
        for (let i = 0; i < amount; i++) weighted.push(userId);
    });

    const winner = weighted[Math.floor(Math.random() * weighted.length)];

    return targetChannel.send(
    `🎉 **Giveaway Winner for _${client.giveaway.name}_:** <@${winner}>`
);

}


// ====== REGISTER SLASH COMMAND ======
const commands = [
    new SlashCommandBuilder()
        .setName('whojoined')
        .setDescription('Show raid participation buttons'),

    new SlashCommandBuilder()
        .setName('whoraided')
        .setDescription('Show raid participation buttons (RAID MODE, double points)'),

    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Start a giveaway (staff only)')
        .addStringOption(opt =>
            opt.setName('length')
                .setDescription('How long should the giveaway last? (e.g. "1d 5h", "30m")')
                .setRequired(true)
        )
.addStringOption(opt =>
    opt.setName('name')
        .setDescription('Name of the giveaway (e.g. Nitro, Robux, Custom Role)')
        .setRequired(true)
)

        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Channel to post the giveaway in')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());
   

// ====== LOGIN ======
client.login(BOT_TOKEN).then(async () => {
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
const giveawayRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId('giveaway_join')
        .setLabel('🎁 Join Giveaway')
        .setStyle(ButtonStyle.Success)
);

function parseLengthToMs(str) {
    const regex = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/gi;
    let match;
    let totalMs = 0;

    while ((match = regex.exec(str)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        if (unit.startsWith('d')) totalMs += value * 24 * 60 * 60 * 1000;
        else if (unit.startsWith('h')) totalMs += value * 60 * 60 * 1000;
        else if (unit.startsWith('m')) totalMs += value * 60 * 1000;
    }

    return totalMs;
}

// ====== INTERACTIONS ======

client.on('interactionCreate', async interaction => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
       const STAFF_ROLE = "1529267990074363984";
        const allowedRoleId = "1515606449332424749";
        const cooldownTime = 3 * 60 * 1000;
        const logChannelId = "1528652282252496926";
if (interaction.commandName === 'giveaway') {

    const STAFF_ROLE = "1529267990074363984";

    if (
        !interaction.member.roles.cache.has(STAFF_ROLE) &&
        interaction.user.id !== interaction.guild.ownerId
    ) {
        return interaction.reply({
            content: "Only staff or the server owner can start giveaways.",
            ephemeral: true
        });
    }

    const lengthStr = interaction.options.getString('length');
    const giveawayName = interaction.options.getString('name');
    const targetChannel = interaction.options.getChannel('channel');

    const durationMs = parseLengthToMs(lengthStr);
    if (!durationMs || durationMs <= 0) {
        return interaction.reply({
            content: "I couldn't understand that length. Try things like `1d 5h`, `30m`, `2h`.",
            ephemeral: true
        });
    }

    const endTimestamp = Math.floor((Date.now() + durationMs) / 1000);

    client.giveaway.active = true;
    client.giveaway.entries = {};
    client.giveaway.channel = targetChannel;
    client.giveaway.name = giveawayName;
    client.giveaway.endTimestamp = endTimestamp;

    client.giveaway.timeout = setTimeout(() => {
        endGiveaway(targetChannel);
    }, durationMs);

    const entryCount = 0;

    const embed = new EmbedBuilder()
        .setTitle(`🎉 SOS HUB GIVEAWAY — ${giveawayName} 🎉`)
        .setColor("#FFCC00")
        .setDescription(
            `**Prize:** ${giveawayName}\n` +
            `**Duration:** ${lengthStr}\n` +
            `**Ends:** <t:${endTimestamp}:F> — <t:${endTimestamp}:R>\n\n` +
            `**Entries:** ${entryCount}\n\n` +
            `Click the button below to join!\n\n🍀 Good luck, everyone!`
        );

    const giveawayMessage = await targetChannel.send({
        embeds: [embed],
        components: [giveawayRow]
    });

    client.giveaway.messageId = giveawayMessage.id;

    return interaction.reply({
        content: `🎉 Giveaway started in ${targetChannel} for **${lengthStr}**!`,
        ephemeral: true
    });
}


        // /whoraided
        if (interaction.commandName === 'whoraided') {
            if (!interaction.member.roles.cache.has(allowedRoleId)) {
                const logChannel = interaction.guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    logChannel.send(`❌ <@${interaction.user.id}> tried to use /whoraided but lacks the required role.`);
                }

                return interaction.reply({
                    content: "You don't have permission to use this command.",
                    ephemeral: true
                });
            }

            const now = Date.now();
            if (now - whoJoinedCooldown < cooldownTime) {
                const remaining = Math.ceil((cooldownTime - (now - whoJoinedCooldown)) / 1000);

                const logChannel = interaction.guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    logChannel.send(`⏳ <@${interaction.user.id}> tried to use /whoraided but cooldown is active (${remaining}s left).`);
                }

                return interaction.reply({
                    content: `Slowmode active. You can use this command again in **${remaining} seconds**.`,
                    ephemeral: true
                });
            }

            whoJoinedCooldown = now;

            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                logChannel.send(`🔥 <@${interaction.user.id}> used /whoraided (RAID MODE).`);
            }

            const msg = await interaction.reply({
                content: '**Who joined the raid:**\nChoose your role (one choice only):',
                components: [row],
                ephemeral: false
            });

            claimedByMessage.set(msg.id, { set: new Set(), called: false, callerName: null });

            setTimeout(() => {
                msg.delete().catch(() => {});
            }, 10 * 60 * 1000);

            return;
        }

        // /whojoined
        if (interaction.commandName === 'whojoined') {
            if (!interaction.member.roles.cache.has(allowedRoleId)) {
                const logChannel = interaction.guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    logChannel.send(`❌ <@${interaction.user.id}> tried to use /whojoined but lacks the required role.`);
                }

                return interaction.reply({
                    content: "You don't have permission to use this command.",
                    ephemeral: true
                });
            }

            const now = Date.now();
            if (now - whoJoinedCooldown < cooldownTime) {
    const remaining = Math.ceil((cooldownTime - (now - whoJoinedCooldown)) / 1000);


                const logChannel = interaction.guild.channels.cache.get(logChannelId);
                if (logChannel) {
                    logChannel.send(`⏳ <@${interaction.user.id}> tried to use /whojoined but cooldown is active (${remaining}s left).`);
                }

                return interaction.reply({
                    content: `Slowmode active. You can use this command again in **${remaining} seconds**.`,
                    ephemeral: true
                });
            }

            whoJoinedCooldown = now;


            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                logChannel.send(`✅ <@${interaction.user.id}> used /whojoined successfully.`);
            }

            const msg = await interaction.reply({
                content: '**Raid Participation:**\nChoose your role (one choice only):',
                components: [row],
                ephemeral: false
            });

            claimedByMessage.set(msg.id, { set: new Set(), called: false, callerName: null });

            setTimeout(() => {
                msg.delete().catch(() => {});
            }, 10 * 60 * 1000);

            return;
        }
    }

    // Button clicks
if (interaction.customId === 'giveaway_join') {

    if (!client.giveaway.active) {
        return interaction.reply({
            content: "There is no active giveaway right now.",
            ephemeral: true
        });
    }

    const userId = interaction.user.id;

    if (client.giveaway.entries[userId]) {
        return interaction.reply({
            content: "You already entered this giveaway.",
            ephemeral: true
        });
    }

    client.giveaway.entries[userId] = 1;

    const entryCount = Object.keys(client.giveaway.entries).length;

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(
            `**Prize:** ${client.giveaway.name}\n` +
            `**Ends:** <t:${client.giveaway.endTimestamp}:F> — <t:${client.giveaway.endTimestamp}:R>\n\n` +
            `**Entries:** ${entryCount}\n\n` +
            `Click the button below to join!\n\n🍀 Good luck, everyone!`
        );

    await interaction.message.edit({
        embeds: [embed],
        components: [giveawayRow]
    });

    return interaction.reply({
        content: "You joined the giveaway! 🎁",
        ephemeral: true
    });
}

    if (interaction.isButton()) {
        const msgId = interaction.message.id;
        const userId = interaction.user.id;

        if (!claimedByMessage.has(msgId)) {
            claimedByMessage.set(msgId, { set: new Set(), called: false, callerName: null });
        }

        const data = claimedByMessage.get(msgId);
        const claimedSet = data.set;

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
            const isRaid = interaction.message.content.includes("Who joined the raid");
            amount = isRaid ? 20 : 10;
            label = isRaid ? 'Joined (RAID)' : 'Joined';
        } else if (interaction.customId === 'called') {
            if (data.called) {
                return interaction.reply({
                    content: `Someone has already claimed **I Called** for this raid.\nCaller: <@${data.callerName}>`,
                    ephemeral: true
                });
            }

            data.called = true;
            data.callerName = userId;

            const isRaid = interaction.message.content.includes("Who joined the raid");
            amount = isRaid ? 30 : 15;
            label = isRaid ? 'Called (RAID)' : 'Called';

            const originalMessage = interaction.message;

            await originalMessage.edit({
                content: `**Raid Participation:**\nChoose your role (one choice only):\n\n📣 **Caller:** <@${userId}>`,
                components: [row]
            });
        }

        claimedSet.add(userId);

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

    // !balance / !currency / !wallet
    if (cmd === 'balance' || cmd === 'currency' || cmd === 'wallet') {
        const userId = message.author.id;
        const bal = getPoints(userId);
        await message.reply(`Your balance: **${bal} points**`);
        return;
    }

    // !leaderboard / !lb
    if (cmd === 'leaderboard' || cmd === 'lb') {
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
        return;
    }

    // !give @user amount
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
        return;
    }

    // !remove @user amount
    if (cmd === 'remove') {
        if (!message.member.permissions.has('Administrator')) {
            await message.reply('You must be an admin to use this command.');
            return;
        }

        const target = message.mentions.users.first();
        const amount = parseInt(args[0], 10);

        if (!target || isNaN(amount)) {
            await message.reply('Usage: `!remove @user amount`');
            return;
        }

        removePoints(target.id, amount);
        await message.reply(`Removed **${amount} points** from <@${target.id}>. New balance: **${getPoints(target.id)}**`);
        return;
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

setInterval(() => {
    const now = new Date();
    const isSunday = now.getDay() === 0;
    const isMidnight = now.getHours() === 0 && now.getMinutes() === 0;

    if (isSunday && isMidnight) {
        resetWeeklyPoints();
    }
}, 60 * 1000);

// ====== SHOP ======
const shopItems = {
    "entry1": { cost: 200, description: "1 extra giveaway entry" },
    "entry2": { cost: 400, description: "2 extra giveaway entries" },
    "instantwin": { cost: 800, description: "Instant giveaway win (only during active giveaway)" }
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
        await message.reply(text);
        return;
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

        points[userId].balance -= item.cost;
savePoints();

// Extra giveaway entries
if (itemName === "entry1") {
    if (!client.giveaway.active) {
        return message.reply("You can only buy extra entries during an active giveaway.");
    }

    if (!client.giveaway.entries[userId] || client.giveaway.entries[userId] <= 0) {
        return message.reply("You must join the giveaway first by clicking the **Join Giveaway** button.");
    }

    client.giveaway.entries[userId] += 1;
    return message.reply("You purchased **1 extra giveaway entry**!");
}

if (itemName === "entry2") {
    if (!client.giveaway.active) {
        return message.reply("You can only buy extra entries during an active giveaway.");
    }

    if (!client.giveaway.entries[userId] || client.giveaway.entries[userId] <= 0) {
        return message.reply("You must join the giveaway first by clicking the **Join Giveaway** button.");
    }

    client.giveaway.entries[userId] += 2;
    return message.reply("You purchased **2 extra giveaway entries**!");
}

if (itemName === "instantwin") {
    if (!client.giveaway.active) {
        return message.reply("Instant win can only be bought during an active giveaway.");
    }

    if (!client.giveaway.entries[userId] || client.giveaway.entries[userId] <= 0) {
        return message.reply("You must join the giveaway first by clicking the **Join Giveaway** button.");
    }

    client.giveaway.entries[userId] = 999999;
    endGiveaway(message.channel);

    return message.reply("You **instantly win** the giveaway!");
}
}
});

// ====== DASHBOARD ======
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

        addPoints(userId, dailyRewardAmount);
        dailyClaims[userId] = now;
        saveDailyClaims();

        return message.reply(`You claimed your **daily reward** of **${dailyRewardAmount} points**!`);
    }
});
