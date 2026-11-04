import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  buildFeedbackEmbed,
  buildStatusEmbed,
  COLORS,
  formatDurationVi,
  getViolationLabel,
} from '../utils/embeds.js';
import {
  auditBotGuildPermissions,
  canBotSendEmbed,
  canManageAntiSpam,
} from '../utils/permissions.js';

export const antispamCommand = {
  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Quản lý và cấu hình hệ thống chống spam @mention cho máy chủ')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)

    // 1. /antispam on
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Bật hệ thống chống spam @mention cho máy chủ')
        .addChannelOption((opt) =>
          opt
            .setName('log_channel')
            .setDescription('Kênh ghi nhận nhật ký xử lý vi phạm (tùy chọn)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )

    // 2. /antispam off
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Tạm tắt hệ thống chống spam @mention trên máy chủ')
    )

    // 3. /antispam config
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Cấu hình giới hạn mention, khoảng thời gian và kênh log')
        .addIntegerOption((opt) =>
          opt
            .setName('max_mentions_msg')
            .setDescription('Số mention tối đa trong 1 tin nhắn (2 - 50)')
            .setMinValue(2)
            .setMaxValue(50)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_mentions_window')
            .setDescription('Tổng số mention tối đa trong khoảng thời gian ngắn (3 - 100)')
            .setMinValue(3)
            .setMaxValue(100)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('time_window')
            .setDescription('Khoảng thời gian kiểm tra mention dồn dập tính bằng giây (3 - 120)')
            .setMinValue(3)
            .setMaxValue(120)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_repeat_messages')
            .setDescription('Số tin nhắn chứa mention liên tiếp tối đa cho phép (2 - 20)')
            .setMinValue(2)
            .setMaxValue(20)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_same_target')
            .setDescription('Số tin nhắn mention lặp lại cùng 1 người tối đa (2 - 15)')
            .setMinValue(2)
            .setMaxValue(15)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('repeat_window')
            .setDescription('Khoảng thời gian kiểm tra tin nhắn lặp tính bằng giây (5 - 180)')
            .setMinValue(5)
            .setMaxValue(180)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('block_everyone')
            .setDescription('Chặn hành vi spam ping @everyone và @here trái phép')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('log_channel')
            .setDescription('Chọn kênh văn bản để nhận nhật ký xử lý vi phạm')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('strike_reset_minutes')
            .setDescription('Thời gian tự đặt lại cấp độ vi phạm tính bằng phút (5 - 10080)')
            .setMinValue(5)
            .setMaxValue(10080)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('auto_delete_warn_sec')
            .setDescription('Giây tự xóa thông báo cảnh cáo tại kênh chat (0 = không xóa, 0 - 60)')
            .setMinValue(0)
            .setMaxValue(60)
            .setRequired(false)
        )
    )

    // 4. /antispam whitelist
    .addSubcommand((sub) =>
      sub
        .setName('whitelist')
        .setDescription('Quản lý danh sách miễn trừ chống spam (vai trò, thành viên, kênh)')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Thao tác muốn thực hiện với danh sách miễn trừ')
            .setRequired(true)
            .addChoices(
              { name: '📋 Xem danh sách (list)', value: 'list' },
              { name: '➕ Thêm vào miễn trừ (add)', value: 'add' },
              { name: '➖ Xóa khỏi miễn trừ (remove)', value: 'remove' },
              { name: '🗑️ Xóa toàn bộ danh sách tùy chỉnh (clear)', value: 'clear' }
            )
        )
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Vai trò (Role) cần thêm hoặc xóa khỏi danh sách miễn trừ')
            .setRequired(false)
        )
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('Thành viên cần thêm hoặc xóa khỏi danh sách miễn trừ')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Kênh được phép mention tự do không kiểm duyệt')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread
            )
            .setRequired(false)
        )
    )

    // 5. /antispam logs
    .addSubcommand((sub) =>
      sub
        .setName('logs')
        .setDescription('Xem lịch sử phát hiện và xử lý spam @mention gần đây')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('Lọc lịch sử vi phạm theo một thành viên cụ thể')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('Số lượng bản ghi muốn xem (1 - 10, mặc định 5)')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('reset_strikes')
            .setDescription('Đặt lại mức cảnh cáo hiện tại của thành viên được chọn')
            .setRequired(false)
        )
    )

    // 6. /antispam status
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Xem trạng thái hoạt động, quyền hạn và hiệu suất của bot')
    )

    // 7. /antispam reset
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Đặt lại toàn bộ cấu hình chống spam về giá trị mặc định')
        .addBooleanOption((opt) =>
          opt
            .setName('keep_logs')
            .setDescription('Giữ lại lịch sử vi phạm cũ sau khi đặt lại cấu hình (mặc định: true)')
            .setRequired(false)
        )
    ),

  /**
   * Thực thi lệnh `/antispam <subcommand>`.
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} context
   * @param {import('../storage/guildStore.js').GuildStore} context.guildStore
   * @param {import('../services/mentionDetector.js').MentionDetector} context.mentionDetector
   * @param {import('../services/punishmentService.js').PunishmentService} context.punishmentService
   */
  async execute(interaction, { guildStore, mentionDetector, punishmentService }) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        embeds: [
          buildFeedbackEmbed({
            color: COLORS.DANGER,
            title: '❌ Không khả dụng trong tin nhắn riêng',
            description: 'Lệnh `/antispam` chỉ có thể sử dụng bên trong máy chủ Discord.',
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const isReadOnlySub = sub === 'status' || (sub === 'logs' && !interaction.options.getBoolean('reset_strikes'));

    if (!canManageAntiSpam(interaction.member, isReadOnlySub)) {
      await interaction.reply({
        embeds: [
          buildFeedbackEmbed({
            color: COLORS.DANGER,
            title: '⛔ Không đủ quyền hạn',
            description: isReadOnlySub
              ? 'Bạn cần quyền **Quản lý Máy chủ (Manage Server)** hoặc **Điều hành viên (Moderate Members)** để xem thông tin này.'
              : 'Bạn cần quyền **Quản trị viên (Administrator)** hoặc **Quản lý Máy chủ (Manage Server)** để thay đổi cấu hình chống spam.',
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    const guildId = guild.id;

    switch (sub) {
      case 'on':
        await handleOn(interaction, { guild, guildId, guildStore });
        break;
      case 'off':
        await handleOff(interaction, { guildId, guildStore });
        break;
      case 'config':
        await handleConfig(interaction, { guild, guildId, guildStore });
        break;
      case 'whitelist':
        await handleWhitelist(interaction, { guildId, guildStore });
        break;
      case 'logs':
        await handleLogs(interaction, { guildId, guildStore, punishmentService });
        break;
      case 'status':
        await handleStatus(interaction, { guild, guildId, guildStore, mentionDetector });
        break;
      case 'reset':
        await handleReset(interaction, {
          guild,
          guildId,
          guildStore,
          punishmentService,
        });
        break;
      default:
        await interaction.reply({
          content: 'Lệnh con không hợp lệ.',
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};

async function handleOn(interaction, { guild, guildId, guildStore }) {
  const logChannel = interaction.options.getChannel('log_channel');
  const patch = { enabled: true };
  let warningNote = '';

  if (logChannel) {
    patch.logChannelId = logChannel.id;
    const me = guild.members?.me;
    if (me && !canBotSendEmbed(logChannel, me)) {
      warningNote = `\n\n⚠️ **Lưu ý:** Bot hiện thiếu quyền \`View Channel\`, \`Send Messages\` hoặc \`Embed Links\` trong kênh <#${logChannel.id}>.`;
    }
  }

  const updated = guildStore.updateConfig(guildId, patch);
  await guildStore.flush();

  await interaction.reply({
    embeds: [
      buildFeedbackEmbed({
        color: COLORS.SUCCESS,
        title: '🟢 Đã BẬT Hệ thống Chống Spam @Mention',
        description:
          `Hệ thống bảo vệ chống spam mention đã được kích hoạt trên **${guild.name}**.` +
          `\n• Giới hạn 1 tin nhắn: **${updated.maxMentionsPerMessage}** mention` +
          `\n• Giới hạn dồn dập: **${updated.maxMentionsWindow}** mention / **${updated.timeWindowSeconds}s**` +
          `\n• Kênh ghi log: ${updated.logChannelId ? `<#${updated.logChannelId}>` : '*Chưa thiết lập (dùng `/antispam config` để chọn)*'}` +
          warningNote,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleOff(interaction, { guildId, guildStore }) {
  guildStore.updateConfig(guildId, { enabled: false });
  await guildStore.flush();

  await interaction.reply({
    embeds: [
      buildFeedbackEmbed({
        color: COLORS.WARNING,
        title: '🔴 Đã TẮT Hệ thống Chống Spam @Mention',
        description:
          'Hệ thống phát hiện và chặn spam mention đã tạm dừng. Mọi cấu hình và danh sách miễn trừ vẫn được giữ nguyên.\nSử dụng `/antispam on` bất cứ lúc nào để kích hoạt lại.',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleConfig(interaction, { guild, guildId, guildStore }) {
  const patch = {};
  const changes = [];

  const maxMsg = interaction.options.getInteger('max_mentions_msg');
  if (maxMsg !== null) {
    patch.maxMentionsPerMessage = maxMsg;
    changes.push(`• Mention tối đa / 1 tin nhắn: **${maxMsg}**`);
  }

  const maxWin = interaction.options.getInteger('max_mentions_window');
  if (maxWin !== null) {
    patch.maxMentionsWindow = maxWin;
    changes.push(`• Tổng mention tối đa / khoảng ngắn: **${maxWin}**`);
  }

  const timeWin = interaction.options.getInteger('time_window');
  if (timeWin !== null) {
    patch.timeWindowSeconds = timeWin;
    changes.push(`• Khoảng thời gian kiểm tra ngắn: **${timeWin} giây**`);
  }

  const maxRepeat = interaction.options.getInteger('max_repeat_messages');
  if (maxRepeat !== null) {
    patch.maxRepeatMessages = maxRepeat;
    changes.push(`• Số tin nhắn chứa mention liên tiếp tối đa: **${maxRepeat}**`);
  }

  const maxSameTarget = interaction.options.getInteger('max_same_target');
  if (maxSameTarget !== null) {
    patch.maxSameTargetMessages = maxSameTarget;
    changes.push(`• Số tin mention lặp cùng 1 người tối đa: **${maxSameTarget}**`);
  }

  const repeatWin = interaction.options.getInteger('repeat_window');
  if (repeatWin !== null) {
    patch.repeatWindowSeconds = repeatWin;
    changes.push(`• Khoảng thời gian kiểm tra tin lặp: **${repeatWin} giây**`);
  }

  const blockEveryone = interaction.options.getBoolean('block_everyone');
  if (blockEveryone !== null) {
    patch.blockEveryoneHere = blockEveryone;
    changes.push(`• Chặn \`@everyone\` / \`@here\`: **${blockEveryone ? 'Bật' : 'Tắt'}**`);
  }

  const logChannel = interaction.options.getChannel('log_channel');
  if (logChannel !== null) {
    patch.logChannelId = logChannel.id;
    changes.push(`• Kênh Log vi phạm: <#${logChannel.id}>`);
  }

  const strikeReset = interaction.options.getInteger('strike_reset_minutes');
  if (strikeReset !== null) {
    patch.strikeResetMinutes = strikeReset;
    changes.push(`• Tự xóa mức phạt sau: **${strikeReset} phút**`);
  }

  const autoDelWarn = interaction.options.getInteger('auto_delete_warn_sec');
  if (autoDelWarn !== null) {
    patch.autoDeleteWarnSeconds = autoDelWarn;
    changes.push(
      `• Tự xóa tin cảnh cáo sau: **${autoDelWarn > 0 ? `${autoDelWarn} giây` : 'Không tự xóa'}**`
    );
  }

  // Nếu người dùng không truyền tùy chọn nào -> hiển thị cấu hình hiện tại
  if (changes.length === 0) {
    const current = guildStore.getConfig(guildId);
    const botPerms = auditBotGuildPermissions(guild);
    await interaction.reply({
      embeds: [
        buildStatusEmbed({
          guild,
          config: current,
          botPerms,
          title: '⚙️ Cấu hình Chống Spam Hiện tại',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = guildStore.updateConfig(guildId, patch);
  await guildStore.flush();

  let extraNote = '';
  if (
    maxMsg !== null &&
    updated.maxMentionsWindow === updated.maxMentionsPerMessage &&
    maxWin === null
  ) {
    extraNote = `\n\nℹ️ *Tổng mention cửa sổ thời gian đã tự động nâng lên **${updated.maxMentionsWindow}** để không thấp hơn giới hạn 1 tin nhắn.*`;
  }

  if (logChannel && guild.members?.me && !canBotSendEmbed(logChannel, guild.members.me)) {
    extraNote += `\n⚠️ *Bot chưa đủ quyền gửi Embed tại kênh <#${logChannel.id}>. Vui lòng cấp quyền Send Messages & Embed Links.*`;
  }

  await interaction.reply({
    embeds: [
      buildFeedbackEmbed({
        color: COLORS.SUCCESS,
        title: '✅ Đã Cập nhật Cấu hình Chống Spam',
        description: `${changes.join('\n')}${extraNote}`,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleWhitelist(interaction, { guildId, guildStore }) {
  const action = interaction.options.getString('action', true);
  const role = interaction.options.getRole('role');
  const user = interaction.options.getUser('user');
  const channel = interaction.options.getChannel('channel');

  if (action === 'list') {
    const cfg = guildStore.getConfig(guildId);
    const rolesStr =
      cfg.whitelistRoles.length > 0
        ? cfg.whitelistRoles.map((id) => `<@&${id}>`).join(', ')
        : '*Chưa có vai trò tùy chỉnh*';
    const usersStr =
      cfg.whitelistUsers.length > 0
        ? cfg.whitelistUsers.map((id) => `<@${id}>`).join(', ')
        : '*Chưa có thành viên tùy chỉnh*';
    const channelsStr =
      cfg.whitelistChannels.length > 0
        ? cfg.whitelistChannels.map((id) => `<#${id}>`).join(', ')
        : '*Chưa có kênh tùy chỉnh*';

    await interaction.reply({
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.INFO,
          title: '🛡️ Danh sách Miễn trừ Chống Spam (Whitelist)',
          description:
            'ℹ️ **Miễn trừ mặc định tự động:** Chủ máy chủ (Owner), Administrator, Manage Server, Moderate Members và Manage Messages luôn được miễn trừ an toàn.',
          fields: [
            { name: `🎭 Vai trò miễn trừ (${cfg.whitelistRoles.length})`, value: rolesStr },
            { name: `👤 Thành viên miễn trừ (${cfg.whitelistUsers.length})`, value: usersStr },
            { name: `💬 Kênh miễn trừ (${cfg.whitelistChannels.length})`, value: channelsStr },
          ],
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'clear') {
    guildStore.clearWhitelist(guildId);
    await guildStore.flush();
    await interaction.reply({
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.WARNING,
          title: '🗑️ Đã Xóa Danh sách Miễn trừ Tùy chỉnh',
          description:
            'Đã làm trống toàn bộ danh sách vai trò, thành viên và kênh miễn trừ tùy chỉnh.\n*(Owner, Admin và Moderator vẫn được miễn trừ mặc định).*',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Action: add hoặc remove
  if (!role && !user && !channel) {
    await interaction.reply({
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.WARNING,
          title: '⚠️ Thiếu đối tượng miễn trừ',
          description:
            'Vui lòng chọn ít nhất một tùy chọn `role`, `user` hoặc `channel` khi thực hiện thêm/xóa.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const results = [];
  const verb = action === 'add' ? 'Đã thêm vào miễn trừ' : 'Đã xóa khỏi miễn trừ';

  if (role) {
    const res = guildStore.modifyWhitelist(guildId, 'role', action, role.id);
    results.push(
      res.changed
        ? `✅ ${verb}: Vai trò <@&${role.id}>`
        : `ℹ️ Vai trò <@&${role.id}> ${action === 'add' ? 'đã có sẵn trong' : 'không nằm trong'} danh sách.`
    );
  }

  if (user) {
    const res = guildStore.modifyWhitelist(guildId, 'user', action, user.id);
    results.push(
      res.changed
        ? `✅ ${verb}: Thành viên <@${user.id}>`
        : `ℹ️ Thành viên <@${user.id}> ${action === 'add' ? 'đã có sẵn trong' : 'không nằm trong'} danh sách.`
    );
  }

  if (channel) {
    const res = guildStore.modifyWhitelist(guildId, 'channel', action, channel.id);
    results.push(
      res.changed
        ? `✅ ${verb}: Kênh <#${channel.id}>`
        : `ℹ️ Kênh <#${channel.id}> ${action === 'add' ? 'đã có sẵn trong' : 'không nằm trong'} danh sách.`
    );
  }

  await guildStore.flush();

  await interaction.reply({
    embeds: [
      buildFeedbackEmbed({
        color: COLORS.SUCCESS,
        title: '🛡️ Cập nhật Danh sách Miễn trừ',
        description: results.join('\n'),
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLogs(interaction, { guildId, guildStore, punishmentService }) {
  const targetUser = interaction.options.getUser('user');
  const limit = interaction.options.getInteger('limit') ?? 5;
  const resetStrikes = interaction.options.getBoolean('reset_strikes') ?? false;

  let strikeNote = '';
  if (resetStrikes) {
    if (targetUser) {
      punishmentService.resetStrikes(guildId, targetUser.id);
      strikeNote = `\n✅ **Đã đặt lại mức cảnh cáo hiện tại của <@${targetUser.id}> về 0.**\n`;
    } else {
      strikeNote =
        '\n⚠️ *Để đặt lại mức cảnh cáo, vui lòng chọn cụ thể tham số `user`.*\n';
    }
  }

  const entries = guildStore.getViolationLogs(guildId, {
    userId: targetUser?.id ?? null,
    limit,
  });

  if (entries.length === 0) {
    await interaction.reply({
      embeds: [
        buildFeedbackEmbed({
          color: COLORS.INFO,
          title: '📜 Lịch sử Xử lý Vi phạm Spam @Mention',
          description:
            `${strikeNote}` +
            (targetUser
              ? `Không tìm thấy bản ghi vi phạm nào của <@${targetUser.id}>.`
              : 'Chưa có hành vi spam @mention nào được ghi nhận trên máy chủ này.'),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fields = entries.map((entry, idx) => {
    const unix = Math.floor(new Date(entry.timestamp).getTime() / 1000);
    const actionBadge = entry.actions?.timeoutApplied
      ? `🔇 Timeout ${formatDurationVi(entry.actions.timeoutSeconds)}`
      : '⚠️ Cảnh cáo & Xóa tin';

    return {
      name: `#${idx + 1} • ${entry.userTag} (Mức ${entry.strikeLevel})`,
      value: [
        `• **Người vi phạm:** <@${entry.userId}> tại <#${entry.channelId}> (<t:${unix}:R>)`,
        `• **Lỗi:** ${getViolationLabel(entry.violationType)} — *${entry.reason}*`,
        `• **Xử lý:** ${actionBadge} | **Nội dung:** \`${(entry.contentPreview || '').slice(0, 90)}\``,
      ].join('\n'),
    };
  });

  const cfg = guildStore.getConfig(guildId);
  let activeStrikeInfo = '';
  if (targetUser) {
    const currentLevel = punishmentService.getUserStrikeLevel(
      guildId,
      targetUser.id,
      cfg.strikeResetMinutes
    );
    activeStrikeInfo = `Mức cảnh cáo đang hiệu lực của <@${targetUser.id}>: **Mức ${currentLevel}**\n`;
  }

  await interaction.reply({
    embeds: [
      buildFeedbackEmbed({
        color: COLORS.PRIMARY,
        title: `📜 Lịch sử Xử lý Vi phạm (${entries.length} bản ghi gần nhất)`,
        description: `${strikeNote}${activeStrikeInfo}Tổng vi phạm toàn máy chủ: **${cfg.stats?.totalViolations ?? 0}**`,
        fields,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatus(interaction, { guild, guildId, guildStore, mentionDetector }) {
  const config = guildStore.getConfig(guildId);
  const botPerms = auditBotGuildPermissions(guild);
  const mem = process.memoryUsage();

  const runtimeStats = {
    heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
    rssMb: (mem.rss / 1024 / 1024).toFixed(1),
    pingMs: Math.max(0, Math.round(interaction.client.ws?.ping ?? 0)),
    trackedUsers: mentionDetector.activeTrackerCount,
    uptimeSeconds: Math.floor(process.uptime()),
  };

  await interaction.reply({
    embeds: [
      buildStatusEmbed({
        guild,
        config,
        botPerms,
        runtimeStats,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReset(
  interaction,
  { guild, guildId, guildStore, punishmentService }
) {
  const keepLogs = interaction.options.getBoolean('keep_logs') ?? true;
  const resetCfg = guildStore.resetConfig(guildId, { keepLogs });
  punishmentService.resetStrikes(guildId);
  await guildStore.flush();

  const botPerms = auditBotGuildPermissions(guild);

  await interaction.reply({
    embeds: [
      buildStatusEmbed({
        guild,
        config: resetCfg,
        botPerms,
        title: `🔄 Đã Đặt lại Cấu hình Mặc định (${keepLogs ? 'Giữ lại lịch sử log' : 'Đã xóa lịch sử log'})`,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
