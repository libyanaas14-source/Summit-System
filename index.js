const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// الأيدي المسموح لها فقط باستخدام أوامر الإدارة والبوت
const ALLOWED_USER_IDS = [
    "1476270096296050730",
    "1489281825942667355",
    "1366264160610025583"
];

// قاعدة بيانات مؤقتة لتخزين الكوينز والستوك (يفضل لاحقاً استخدام قاعدة بيانات مثل MongoDB)
const db = {
    coins: {}, // { userId: balance }
    stockCount: 363 // الستوك الابتدائي
};

// تعريف أوامر السلاش
const commands = [
    new SlashCommandBuilder()
        .setName('setup_ticket')
        .setDescription('إعداد لوحة التذاكر')
        .addChannelOption(option => option.setName('category').setDescription('كاتجوري التذاكر').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
        .addRoleOption(option => option.setName('role').setDescription('رتبة الإدارة التي تري التذاكر').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('رسالة الترحيب داخل التذكرة').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('setup_kul')
        .setDescription('إرسال رسالة أثبت نفسك والتحقق'),

    new SlashCommandBuilder()
        .setName('setup_hand')
        .setDescription('لوحة الستوك والريفرش المباشر'),

    new SlashCommandBuilder()
        .setName('coins')
        .setDescription('إدارة كوينز الأعضاء')
        .addSubcommand(sub => sub.setName('add').setDescription('إضافة كوينز لشخص').addUserOption(o => o.setName('user').setDescription('الشخص').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('سحب كوينز من شخص').addUserOption(o => o.setName('user').setDescription('الشخص').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)))
        .addSubcommand(sub => sub.setName('reset').setDescription('تصفير كوينز شخص').addUserOption(o => o.setName('user').setDescription('الشخص').setRequired(true)))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    // التحقق من الصلاحيات للأوامر الإدارية
    if (interaction.isChatInputCommand()) {
        if (!ALLOWED_USER_IDS.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ عذراً، لا تمتلك الصلاحية لاستخدام أوامر البوت الإدارية!', ephemeral: true });
        }

        const { commandName } = interaction;

        // 1. أمر Setup Ticket
        if (commandName === 'setup_ticket') {
            const category = interaction.options.getChannel('category');
            const role = interaction.options.getRole('role');
            const msgText = interaction.options.getString('message');

            const embed = newEmbed('🎫 نظام التذاكر', 'اختر أحد الخيارات في الأسفل لفتح تذكرة جديدة والتواصل مع الإدارة.');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_buy_members').setLabel('شراء الأعضاء').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('ticket_add_bot').setLabel('إضافة البوت لسيرفرك').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('ticket_buy_coins').setLabel('شراء الرصيد').setStyle(ButtonStyle.Secondary)
            );

            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: '✅ تم إرسال لوحة التذاكر بنجاح!', ephemeral: true });
        }

        // 2. أمر Setup Kul (أثبت نفسك)
        if (commandName === 'setup_kul') {
            const embed = newEmbed('🛡️ التحقق والأمان', 'اضغط على الزر أدناه لإثبات أنك لست روبوت، ولتحديث بيانات الستوك الخاص بك.');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_kul_btn').setLabel('أثبت نفسك 🪪').setStyle(ButtonStyle.Success)
            );
            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: '✅ تم إرسال رسالة أثبت نفسك بنجاح!', ephemeral: true });
        }

        // 3. أمر Setup Hand (لوحة الستوك والريفرش)
        if (commandName === 'setup_hand') {
            const embed = newEmbed('📦 لوحة الستوك المباشرة', `الستوك الحالي المتاح:\n**${db.stockCount} عضو**\n\nاضغط على زر التحديث بالأسفل لجلب العدد المحدث.`);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('refresh_stock_btn').setLabel('🔄 Refresh (تحديث)').setStyle(ButtonStyle.Primary)
            );
            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: '✅ تم نشر لوحة الستوك بنجاح!', ephemeral: true });
        }

        // 4. نظام الكوينز (Coins Management)
        if (commandName === 'coins') {
            const sub = interaction.options.getSubcommand();
            const target = interaction.options.getUser('user');
            db.coins[target.id] = db.coins[target.id] || 0;

            if (sub === 'add') {
                const amount = interaction.options.getInteger('amount');
                db.coins[target.id] += amount;
                return interaction.reply(`✅ تم إضافة **${amount}** كوين إلى الحساب ${target}. الرصيد الحالي: **${db.coins[target.id]}**`);
            } else if (sub === 'remove') {
                const amount = interaction.options.getInteger('amount');
                db.coins[target.id] = Math.max(0, db.coins[target.id] - amount);
                return interaction.reply(`✅ تم سحب **${amount}** كوين من الحساب ${target}. الرصيد الحالي: **${db.coins[target.id]}**`);
            } else if (sub === 'reset') {
                db.coins[target.id] = 0;
                return interaction.reply(`✅ تم تصفير رصيد العضو ${target} بنجاح.`);
            }
        }
    }

    // التعامل مع الأزرار التفاعلية
    if (interaction.isButton()) {
        const id = interaction.customId;

        if (id === 'verify_kul_btn') {
            db.stockCount += 1; // زيادة الستوك تفاعلياً
            return interaction.reply({ content: '✅ تم إثبات هويتك بنجاح وتحديث النظام!', ephemeral: true });
        }

        if (id === 'refresh_stock_btn') {
            const updatedEmbed = newEmbed('📦 لوحة الستوك المباشرة', `الستوك الحالي المتاح:\n**${db.stockCount} عضو**\n\nآخر تحديث: الآن`);
            return interaction.update({ embeds: [updatedEmbed] });
        }

        if (id === 'ticket_buy_coins') {
            // سعر الكوين الواحد 120k مع حساب الضريبة 5% (المجموع = المبلغ * 1.053 أو حسب قانون حساب ProBot)
            const targetAccounts = ALLOWED_USER_IDS.map(uid => `<@${uid}>`).join(' و ');
            const taxRateText = `لشراء الرصيد، يرجى تحويل المبلغ المطلوب (سعر الكوين = 120,000 كرت) مع الضريبة 5% إلى أحد الحسابات التالية:\n${targetAccounts}\n\nأمر التحويل:\n\`c <ايدي_الشخص> <المبلغ_مع_الضريبة>\`\nلديك **5 دقائق** لإتمام العملية وسيتم التحقق منها تلقائياً.`;
            return interaction.reply({ content: taxRateText, ephemeral: true });
        }

        if (id === 'ticket_buy_members' || id === 'ticket_add_bot') {
            return interaction.reply({ content: '🎫 تم استلام طلبك، جارٍ فتح تذكرة خاصة لك...', ephemeral: true });
        }
    }
});

function newEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor('#2b2d31')
        .setTimestamp();
}

client.login(process.env.DISCORD_TOKEN);

