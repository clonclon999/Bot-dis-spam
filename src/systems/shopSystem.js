import { PET_SPECIES, SHOP_ITEMS } from '../config/constants.js';
import { formatVnd } from '../utils/format.js';
import { secureInt } from '../utils/rng.js';

/**
 * Hệ thống Cửa hàng (Shop), Túi đồ (Inventory), Mua/Bán và Sử dụng vật phẩm (bao gồm Hộp Quà Bí Ẩn).
 */
export class ShopSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   * @param {import('./economySystem.js').EconomySystem} deps.economySystem
   * @param {import('./petSystem.js').PetSystem} deps.petSystem
   * @param {import('./levelSystem.js').LevelSystem} deps.levelSystem
   */
  constructor({ db, economySystem, petSystem, levelSystem }) {
    this.db = db;
    this.economySystem = economySystem;
    this.petSystem = petSystem;
    this.levelSystem = levelSystem;
  }

  listCatalog() {
    return Object.values(SHOP_ITEMS);
  }

  getInventory(userId) {
    const rows = this.db.all(
      'SELECT item_id, quantity FROM inventory WHERE user_id = ? AND quantity > 0 ORDER BY item_id ASC',
      [String(userId)]
    );
    return rows
      .map((r) => ({
        item: SHOP_ITEMS[r.item_id],
        quantity: r.quantity,
      }))
      .filter((x) => Boolean(x.item));
  }

  buyItem(userId, username, itemId, quantity = 1, now = Date.now()) {
    const item = SHOP_ITEMS[itemId];
    if (!item) {
      throw new Error('Vật phẩm không tồn tại trong cửa hàng.');
    }
    const qty = Math.max(1, Math.min(99, Math.trunc(Number(quantity) || 1)));
    const totalCost = item.price * qty;

    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      if (user.wallet < totalCost) {
        throw new Error(
          `Không đủ tiền! Cần **${formatVnd(totalCost)}** để mua **x${qty} ${item.emoji} ${item.name}** (Hiện có: ${formatVnd(user.wallet)}).`
        );
      }

      const nextWallet = user.wallet - totalCost;
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        nextWallet,
        now,
        String(userId),
      ]);

      this.db.run(
        `INSERT INTO inventory (user_id, item_id, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
        [String(userId), item.id, qty]
      );

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'shop_buy', ?, ?, ?, ?)`,
        [String(userId), -totalCost, nextWallet, `Mua x${qty} ${item.name}`, now]
      );

      return { item, quantity: qty, totalCost, balanceAfter: nextWallet };
    });
  }

  sellItem(userId, username, itemId, quantity = 1, now = Date.now()) {
    const item = SHOP_ITEMS[itemId];
    if (!item) throw new Error('Vật phẩm không hợp lệ.');

    const qty = Math.max(1, Math.min(99, Math.trunc(Number(quantity) || 1)));
    const totalProceeds = item.sellPrice * qty;

    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      const inv = this.db.get(
        'SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [String(userId), item.id]
      );
      if (!inv || inv.quantity < qty) {
        throw new Error(
          `Bạn không có đủ **${item.name}** để bán (Hiện có: ${inv?.quantity ?? 0}).`
        );
      }

      const nextWallet = user.wallet + totalProceeds;
      this.db.run(
        'UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND item_id = ?',
        [qty, String(userId), item.id]
      );
      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        nextWallet,
        now,
        String(userId),
      ]);

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'shop_sell', ?, ?, ?, ?)`,
        [String(userId), totalProceeds, nextWallet, `Bán x${qty} ${item.name}`, now]
      );

      return { item, quantity: qty, totalProceeds, balanceAfter: nextWallet };
    });
  }

  /**
   * Sử dụng vật phẩm trong túi đồ với tác dụng thực tế ngay lập tức.
   */
  useItem(userId, username, itemId, now = Date.now()) {
    const item = SHOP_ITEMS[itemId];
    if (!item) throw new Error('Vật phẩm không tồn tại.');

    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      const inv = this.db.get(
        'SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [String(userId), item.id]
      );
      if (!inv || inv.quantity < 1) {
        throw new Error(
          `Bạn chưa có **${item.emoji} ${item.name}** trong túi đồ! Hãy mua tại \`/shop\`.`
        );
      }

      // Nếu là pet_food, kiểm tra có thú cưng đang trang bị trước khi trừ vật phẩm
      if (item.id === 'pet_food') {
        if (!user.active_pet_id) {
          throw new Error('Bạn chưa trang bị thú cưng nào để cho ăn! Hãy dùng `/pet` trước.');
        }
        // feedPet tự trừ 1 pet_food trong túi
        const feedRes = this.petSystem.feedPet(userId, username, user.active_pet_id, now);
        return {
          item,
          effectMessage: `Đã cho **${feedRes.pet.nickname}** ăn no (**${feedRes.pet.hunger}/100**) và nhận **+60 EXP thú cưng**${feedRes.leveledUp ? ` 🎉 (Thăng lên Lv.${feedRes.pet.level}!)` : ''}.`,
        };
      }

      // Trừ 1 vật phẩm khỏi túi đồ
      this.db.run(
        'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?',
        [String(userId), item.id]
      );

      const twoHoursMs = 2 * 3600 * 1000;
      const dayMs = 24 * 3600 * 1000;

      switch (item.id) {
        case 'energy_drink': {
          this.db.run('UPDATE users SET last_work_at = 0, updated_at = ? WHERE user_id = ?', [
            now,
            String(userId),
          ]);
          return {
            item,
            effectMessage: '⚡ Đã nạp đầy năng lượng! Bạn có thể dùng `/work` ngay lập tức.',
          };
        }

        case 'lucky_ticket': {
          const base = Math.max(now, user.lucky_boost_until || 0);
          const until = base + twoHoursMs;
          this.db.run('UPDATE users SET lucky_boost_until = ?, updated_at = ? WHERE user_id = ?', [
            until,
            now,
            String(userId),
          ]);
          return {
            item,
            effectMessage: '🎟️ Đã kích hoạt **Vé May Mắn (+35% thưởng Đi làm & Nhiệm vụ)** thêm **2 giờ**!',
          };
        }

        case 'exp_card_2x': {
          const base = Math.max(now, user.exp_boost_until || 0);
          const until = base + twoHoursMs;
          this.db.run('UPDATE users SET exp_boost_until = ?, updated_at = ? WHERE user_id = ?', [
            until,
            now,
            String(userId),
          ]);
          return {
            item,
            effectMessage: '✨ Đã kích hoạt **Thẻ Nhân Đôi EXP (x2 EXP)** thêm **2 giờ**!',
          };
        }

        case 'rob_shield': {
          const base = Math.max(now, user.protected_until || 0);
          const until = base + dayMs;
          this.db.run('UPDATE users SET protected_until = ?, updated_at = ? WHERE user_id = ?', [
            until,
            now,
            String(userId),
          ]);
          return {
            item,
            effectMessage: '🛡️ Đã kích hoạt **Bảo Hiểm Chống Cướp** thêm **24 giờ**!',
          };
        }

        case 'frame_gold':
        case 'frame_cyber': {
          this.db.run('UPDATE users SET active_frame = ?, updated_at = ? WHERE user_id = ?', [
            item.id,
            now,
            String(userId),
          ]);
          return {
            item,
            effectMessage: `🖼️ Đã trang bị khung hồ sơ **${item.name}** lên thẻ \`/profile\` của bạn!`,
          };
        }

        case 'title_legend': {
          this.levelSystem.unlockSpecificTitle(userId, item.unlockTitleId);
          this.levelSystem.equipTitle(userId, item.unlockTitleId);
          return {
            item,
            effectMessage: '🏅 Đã mở khóa và đeo danh hiệu **Huyền Thoại Viễn Chinh**!',
          };
        }

        case 'pet_egg': {
          const r = secureInt(1, 100);
          const speciesId = r <= 45 ? 'dog_shiba' : r <= 78 ? 'cat_fortune' : r <= 95 ? 'fox_snow' : 'dragon_jade';
          const pet = this.petSystem.grantPetDirect(userId, speciesId, now);
          const sp = PET_SPECIES[speciesId];
          return {
            item,
            effectMessage: `🥚 Trứng Thú Cưng đã nở thành **${sp.emoji} ${pet.nickname} (${sp.rarity})**! Kiểm tra ngay tại \`/pet\`.`,
          };
        }

        case 'mystery_box': {
          const roll = secureInt(1, 100);
          // 8% cơ hội trúng Thú Hiếm Kỳ Lân Tinh Tú!
          if (roll <= 8) {
            const pet = this.petSystem.grantPetDirect(userId, 'unicorn_star', now);
            return {
              item,
              effectMessage: `🌠 **SIÊU HIẾM!** Bạn mở Hộp Quà Bí Ẩn và trúng thú thần thoại **${PET_SPECIES.unicorn_star.emoji} ${pet.nickname}** (+30% EXP & Nhiệm vụ)!`,
            };
          }
          // 22% trúng Thẻ x2 EXP + Nước tăng lực
          if (roll <= 30) {
            this.db.run(
              `INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, 'exp_card_2x', 1)
               ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1`,
              [String(userId)]
            );
            this.db.run(
              `INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, 'energy_drink', 1)
               ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + 1`,
              [String(userId)]
            );
            return {
              item,
              effectMessage: '🎁 Bạn mở hộp nhận được combo **1x ✨ Thẻ Nhân Đôi EXP** + **1x ⚡ Nước Tăng Lực**!',
            };
          }
          // 70% trúng tiền thưởng ngẫu nhiên 12.000 - 80.000 VNĐ
          const prizeVnd = secureInt(12_000, 80_000);
          const fresh = this.db.get('SELECT wallet FROM users WHERE user_id = ?', [String(userId)]);
          const nextW = fresh.wallet + prizeVnd;
          this.db.run('UPDATE users SET wallet = ?, total_earned = total_earned + ? WHERE user_id = ?', [
            nextW,
            prizeVnd,
            String(userId),
          ]);
          this.db.run(
            `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
             VALUES (?, 'mystery_box', ?, ?, 'Mở Hộp Quà Bí Ẩn', ?)`,
            [String(userId), prizeVnd, nextW, now]
          );
          return {
            item,
            effectMessage: `🎁 Bạn mở Hộp Quà Bí Ẩn và nhận được **${formatVnd(prizeVnd)}**!`,
          };
        }

        default:
          throw new Error('Vật phẩm này không thể sử dụng trực tiếp.');
      }
    });
  }
}
