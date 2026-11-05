import { SlashCommandBuilder } from 'discord.js';
import { PET_SPECIES } from '../../config/constants.js';
import { buildCv2NoticePayload } from '../../ui/componentsV2.js';
import { safeReplyV2 } from '../../ui/interactionHelpers.js';
import { renderNeonBar, THEME } from '../../ui/theme.js';
import { formatVnd } from '../../utils/format.js';

const BUYABLE_SPECIES = Object.values(PET_SPECIES)
  .filter((p) => !p.boxOnly)
  .map((p) => ({
    name: `${p.emoji} ${p.name} [${p.rarity}] — ${formatVnd(p.price)}`,
    value: p.id,
  }));

export const petCommand = {
  data: new SlashCommandBuilder()
    .setName('pet')
    .setDescription('Hệ thống nuôi Thú Cưng, cho ăn, nâng cấp và bộ sưu tập thú hiếm (Components V2)')
    .addSubcommand((s) =>
      s.setName('shop').setDescription('Xem danh sách các loài thú cưng và chỉ số Bonus')
    )
    .addSubcommand((s) =>
      s
        .setName('buy')
        .setDescription('Nhận nuôi một thú cưng mới')
        .addStringOption((o) =>
          o.setName('species').setDescription('Chọn loài thú cưng').setRequired(true).addChoices(...BUYABLE_SPECIES)
        )
        .addStringOption((o) =>
          o.setName('nickname').setDescription('Đặt tên riêng cho thú cưng (tùy chọn)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s.setName('info').setDescription('Xem chi tiết thú cưng đang đồng hành cùng bạn')
    )
    .addSubcommand((s) =>
      s
        .setName('feed')
        .setDescription('Cho thú cưng ăn hồi độ no và tăng EXP')
        .addIntegerOption((o) =>
          o.setName('pet_id').setDescription('Mã ID thú cưng (bỏ trống sẽ cho thú đang trang bị ăn)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('upgrade')
        .setDescription('Huấn luyện nâng cấp trực tiếp cho thú cưng bằng VNĐ')
        .addIntegerOption((o) =>
          o.setName('pet_id').setDescription('Mã ID thú cưng (bỏ trống để nâng cấp thú đang trang bị)').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Đổi tên mới cho thú cưng')
        .addIntegerOption((o) =>
          o.setName('pet_id').setDescription('Mã ID thú cưng').setRequired(true)
        )
        .addStringOption((o) =>
          o.setName('name').setDescription('Tên mới (2 - 28 ký tự)').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('equip')
        .setDescription('Chọn thú cưng đồng hành chính')
        .addIntegerOption((o) =>
          o.setName('pet_id').setDescription('Mã ID thú cưng trong bộ sưu tập').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('collection')
        .setDescription('Xem toàn bộ bộ sưu tập thú cưng đã sở hữu')
        .addUserOption((o) =>
          o.setName('user').setDescription('Xem bộ sưu tập của người chơi khác').setRequired(false)
        )
    ),

  async execute(interaction, { petSystem }) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    const uname = interaction.user.username;

    if (sub === 'shop') {
      const lines = Object.values(PET_SPECIES).map((p) => {
        const priceTag = p.boxOnly ? '🎁 *Mở từ Hộp Quà Bí Ẩn*' : `**${formatVnd(p.price)}**`;
        return (
          `${p.emoji} **${p.name}** • Độ hiếm: \`${p.rarity}\` — ${priceTag}\n` +
          `  ↳ Bonus: **+${p.expBonusPct}% EXP** | **+${p.questBonusPct}% Thưởng Nhiệm vụ & Đi làm** | Hiệu ứng: *${p.effectLabel}*`
        );
      });

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🐾 Trại Thú Cưng & Linh Thú Huyền Thoại',
          body:
            lines.join('\n\n') +
            '\n\n*(Lưu ý: Bonus thú cưng chỉ hỗ trợ cày EXP và Nhiệm vụ, đảm bảo các trò chơi 100% công bằng).*',
          accentColor: THEME.NEON_PURPLE,
        })
      );
      return;
    }

    if (sub === 'buy') {
      const speciesId = interaction.options.getString('species', true);
      const nickname = interaction.options.getString('nickname');
      const res = petSystem.buyPet(uid, uname, speciesId, nickname);

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🎉 Nhận Nuôi Thú Cưng Thành Công!',
          body:
            `Chào mừng ${res.species.emoji} **${res.pet.nickname}** (ID: \`#${res.pet.id}\`) về đội của bạn!\n` +
            `💵 Số dư ví còn lại: **${formatVnd(res.balanceAfter)}**`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
      return;
    }

    if (sub === 'info') {
      const active = petSystem.getActivePetBonuses(uid);
      if (!active.pet) {
        await safeReplyV2(
          interaction,
          buildCv2NoticePayload({
            title: '🐾 Chưa Trang Bị Thú Cưng',
            body: 'Bạn chưa sở hữu hoặc chưa trang bị thú cưng nào! Hãy ghé thăm `/pet shop`.',
            accentColor: THEME.AMBER_PULSE,
          })
        );
        return;
      }

      const p = active.pet;
      const reqExp = p.level * 100;
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: `${active.species.emoji} ${p.nickname} (ID #${p.id}) — Lv.${p.level}`,
          body:
            `• 🧬 **Loài & Độ hiếm:** ${active.species.name} (\`${active.species.rarity}\`)\n` +
            `• 🍖 **Độ no hiện tại:** \`${renderNeonBar(p.currentHunger, 100, 8)}\` (**${p.currentHunger}/100**)\n` +
            `• 📈 **Tiến độ cấp thú:** \`${p.exp}/${reqExp} EXP\`\n\n` +
            `### ✨ Hiệu Ứng & Bonus Đang Kích Hoạt\n` +
            `• Cộng EXP: **+${active.expBonusPct}%**\n` +
            `• Cộng thưởng Nhiệm vụ/Đi làm: **+${active.questBonusPct}%**\n` +
            `• Hiệu ứng hồ sơ: **${active.effectLabel}**`,
          accentColor: THEME.NEON_CYAN,
        })
      );
      return;
    }

    if (sub === 'feed') {
      const petId = interaction.options.getInteger('pet_id');
      const res = petSystem.feedPet(uid, uname, petId);
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🍖 Cho Thú Cưng Ăn Thành Công!',
          body:
            `${res.species.emoji} **${res.pet.nickname}** rất thích bữa ăn này!\n` +
            `• Nguồn thức ăn: ${res.usedBagFood ? 'Túi đồ (1x 🍖 Thức Ăn)' : `Mua nhanh (-${formatVnd(res.foodCost)})`}\n` +
            `• Độ no hiện tại: **${res.pet.hunger}/100** | Cấp độ: **Lv.${res.pet.level}** ${res.leveledUp ? '🎉 *(Vừa lên cấp!)*' : ''}`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
      return;
    }

    if (sub === 'upgrade') {
      const petId = interaction.options.getInteger('pet_id');
      const res = petSystem.upgradePet(uid, uname, petId);
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '⬆️ Huấn Luyện Thú Cưng Lên Cấp!',
          body:
            `${res.species.emoji} **${res.pet.nickname}** đã thăng lên **Cấp ${res.pet.level}** (-${formatVnd(res.cost)})!\n` +
            `💵 Ví còn lại: **${formatVnd(res.balanceAfter)}**`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
      return;
    }

    if (sub === 'rename') {
      const petId = interaction.options.getInteger('pet_id', true);
      const name = interaction.options.getString('name', true);
      const updated = petSystem.renamePet(uid, petId, name);
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '✏️ Đổi Tên Thú Cưng Thành Công',
          body: `Thú cưng \`#${updated.id}\` từ nay mang tên **${updated.nickname}**!`,
          accentColor: THEME.NEON_CYAN,
        })
      );
      return;
    }

    if (sub === 'equip') {
      const petId = interaction.options.getInteger('pet_id', true);
      const equipped = petSystem.equipPet(uid, petId);
      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🐾 Đã Chọn Thú Cưng Đồng Hành',
          body: `${equipped.species?.emoji ?? '🐾'} **${equipped.nickname}** (Lv.${equipped.level}) hiện đang đồng hành cùng bạn!`,
          accentColor: THEME.CYBER_EMERALD,
        })
      );
      return;
    }

    const target = interaction.options.getUser('user') ?? interaction.user;
    const list = petSystem.getUserPets(target.id);
    const lines =
      list.length > 0
        ? list.map(
            (p) =>
              `• \`#${p.id}\` ${p.species?.emoji ?? '🐾'} **${p.nickname}** — **Lv.${p.level}** (\`${p.species?.rarity}\`) • Độ no: ${p.currentHunger}%`
          )
        : ['*Chưa sở hữu thú cưng nào.*'];

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `📚 Bộ Sưu Tập Thú Cưng — ${target.username} (${list.length} cá thể)`,
        body: lines.join('\n'),
        accentColor: THEME.NEON_PURPLE,
      })
    );
  },
};

export const PET_COMMANDS = [petCommand];
