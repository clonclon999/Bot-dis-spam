import { PET_SPECIES, SHOP_ITEMS } from '../config/constants.js';

/**
 * Hệ thống Thú cưng (Pets):
 * - Mua, nhận thú hiếm, cho ăn, tăng cấp, đổi tên, trang bị và bộ sưu tập.
 * - Mang lại Bonus EXP, Bonus thưởng nhiệm vụ/đi làm, Danh hiệu & Hiệu ứng hồ sơ.
 * - TUYỆT ĐỐI KHÔNG can thiệp vào xác suất ngẫu nhiên (RNG) của các trò chơi.
 */
export class PetSystem {
  /**
   * @param {object} deps
   * @param {import('../database/db.js').GameDatabase} deps.db
   */
  constructor({ db }) {
    this.db = db;
    this.economySystem = null;
    this.levelSystem = null;
  }

  bindSystems({ economySystem, levelSystem }) {
    this.economySystem = economySystem;
    this.levelSystem = levelSystem;
  }

  /**
   * Tính toán độ đói thực tế theo thời gian trôi qua kể từ lần cho ăn gần nhất.
   */
  computeCurrentHunger(pet, now = Date.now()) {
    if (!pet) return 0;
    const hoursElapsed = Math.max(0, (now - pet.last_fed_at) / (3600 * 1000));
    const decay = Math.floor(hoursElapsed * 4); // Giảm 4 độ no mỗi giờ
    return Math.max(0, Math.min(100, pet.hunger - decay));
  }

  /**
   * Lấy chỉ số cộng thêm hiện tại từ thú cưng đang trang bị.
   * Nếu thú cưng quá đói (hunger === 0), hiệu lực bonus giảm còn một nửa cho tới khi được cho ăn.
   *
   * @param {string} userId
   * @param {number} [now=Date.now()]
   * @returns {{ expBonusPct: number, questBonusPct: number, effectLabel: string | null, pet: object | null, species: object | null }}
   */
  getActivePetBonuses(userId, now = Date.now()) {
    const user = this.db.get('SELECT active_pet_id FROM users WHERE user_id = ?', [
      String(userId),
    ]);
    if (!user?.active_pet_id) {
      return { expBonusPct: 0, questBonusPct: 0, effectLabel: null, pet: null, species: null };
    }

    const pet = this.db.get(
      'SELECT * FROM pets WHERE id = ? AND user_id = ?',
      [user.active_pet_id, String(userId)]
    );
    if (!pet) {
      return { expBonusPct: 0, questBonusPct: 0, effectLabel: null, pet: null, species: null };
    }

    const species = PET_SPECIES[pet.species_id];
    if (!species) {
      return { expBonusPct: 0, questBonusPct: 0, effectLabel: null, pet: null, species: null };
    }

    const hunger = this.computeCurrentHunger(pet, now);
    const hungerFactor = hunger > 0 ? 1.0 : 0.5;
    // Mỗi cấp thú cưng tăng thêm +1% EXP & +1% thưởng nhiệm vụ (tối đa cấp 30)
    const levelBonus = Math.min(30, Math.max(0, pet.level - 1));

    return {
      expBonusPct: Math.round((species.expBonusPct + levelBonus) * hungerFactor),
      questBonusPct: Math.round((species.questBonusPct + levelBonus) * hungerFactor),
      effectLabel: species.effectLabel,
      pet: { ...pet, currentHunger: hunger },
      species,
    };
  }

  getUserPets(userId, now = Date.now()) {
    const rows = this.db.all(
      'SELECT * FROM pets WHERE user_id = ? ORDER BY level DESC, id ASC',
      [String(userId)]
    );
    return rows.map((p) => ({
      ...p,
      currentHunger: this.computeCurrentHunger(p, now),
      species: PET_SPECIES[p.species_id] ?? null,
    }));
  }

  /**
   * Mua thú cưng từ cửa hàng.
   */
  buyPet(userId, username, speciesId, customNickname = null, now = Date.now()) {
    const species = PET_SPECIES[speciesId];
    if (!species) {
      throw new Error('Loài thú cưng không tồn tại.');
    }
    if (species.boxOnly) {
      throw new Error(`Thú hiếm **${species.name}** chỉ có thể mở khóa từ **Hộp Quà Bí Ẩn**!`);
    }

    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      if (user.wallet < species.price) {
        throw new Error(
          `Không đủ tiền! Cần **${species.price.toLocaleString('vi-VN')} VNĐ** để nhận nuôi ${species.emoji} **${species.name}**.`
        );
      }

      const nickname = (customNickname || species.name).trim().slice(0, 28) || species.name;
      const newWallet = user.wallet - species.price;

      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        newWallet,
        now,
        String(userId),
      ]);

      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'pet_buy', ?, ?, ?, ?)`,
        [String(userId), -species.price, newWallet, `Nhận nuôi ${species.name}`, now]
      );

      this.db.run(
        `INSERT INTO pets (user_id, species_id, nickname, level, exp, hunger, last_fed_at, created_at)
         VALUES (?, ?, ?, 1, 0, 100, ?, ?)`,
        [String(userId), species.id, nickname, now, now]
      );

      const createdPet = this.db.get(
        'SELECT * FROM pets WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [String(userId)]
      );

      // Tự động trang bị nếu chưa có thú cưng đang kích hoạt
      if (!user.active_pet_id && createdPet) {
        this.db.run('UPDATE users SET active_pet_id = ? WHERE user_id = ?', [
          createdPet.id,
          String(userId),
        ]);
      }

      if (species.unlockTitleId) {
        this.levelSystem?.unlockSpecificTitle(userId, species.unlockTitleId);
      }
      this.levelSystem?.evaluateMilestoneTitles(userId);

      return { pet: createdPet, species, balanceAfter: newWallet };
    });
  }

  /**
   * Mở khóa miễn phí thú hiếm (từ Hộp Quà Bí Ẩn hoặc phần thưởng sự kiện).
   */
  grantPetDirect(userId, speciesId, now = Date.now()) {
    const species = PET_SPECIES[speciesId];
    if (!species) throw new Error('Loài thú không hợp lệ.');

    return this.db.transaction(() => {
      this.db.run(
        `INSERT INTO pets (user_id, species_id, nickname, level, exp, hunger, last_fed_at, created_at)
         VALUES (?, ?, ?, 1, 0, 100, ?, ?)`,
        [String(userId), species.id, species.name, now, now]
      );
      const createdPet = this.db.get(
        'SELECT * FROM pets WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [String(userId)]
      );
      const user = this.db.get('SELECT active_pet_id FROM users WHERE user_id = ?', [
        String(userId),
      ]);
      if (user && !user.active_pet_id && createdPet) {
        this.db.run('UPDATE users SET active_pet_id = ? WHERE user_id = ?', [
          createdPet.id,
          String(userId),
        ]);
      }
      if (species.unlockTitleId) {
        this.levelSystem?.unlockSpecificTitle(userId, species.unlockTitleId);
      }
      this.levelSystem?.evaluateMilestoneTitles(userId);
      return createdPet;
    });
  }

  /**
   * Cho thú cưng ăn (ưu tiên dùng `pet_food` trong túi đồ, nếu không có sẽ mua nhanh giá `pet_food`).
   */
  feedPet(userId, username, petId = null, now = Date.now()) {
    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      const targetId = petId ?? user.active_pet_id;
      if (!targetId) {
        throw new Error('Bạn chưa chọn hoặc chưa sở hữu thú cưng nào.');
      }

      const pet = this.db.get('SELECT * FROM pets WHERE id = ? AND user_id = ?', [
        targetId,
        String(userId),
      ]);
      if (!pet) {
        throw new Error('Không tìm thấy thú cưng này trong bộ sưu tập của bạn.');
      }

      const invFood = this.db.get(
        "SELECT quantity FROM inventory WHERE user_id = ? AND item_id = 'pet_food'",
        [String(userId)]
      );

      let usedBagFood = false;
      const foodCost = SHOP_ITEMS.pet_food.price;

      if (invFood && invFood.quantity > 0) {
        usedBagFood = true;
        this.db.run(
          "UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = 'pet_food'",
          [String(userId)]
        );
      } else {
        if (user.wallet < foodCost) {
          throw new Error(
            `Bạn không có sẵn **Thức Ăn Thú Cưng** trong túi đồ và không đủ **${foodCost.toLocaleString('vi-VN')} VNĐ** để mua nhanh.`
          );
        }
        const nextWallet = user.wallet - foodCost;
        this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
          nextWallet,
          now,
          String(userId),
        ]);
        this.db.run(
          `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
           VALUES (?, 'pet_feed', ?, ?, ?, ?)`,
          [String(userId), -foodCost, nextWallet, `Mua thức ăn cho ${pet.nickname}`, now]
        );
      }

      const currentHunger = this.computeCurrentHunger(pet, now);
      const newHunger = Math.min(100, currentHunger + 45);
      let newExp = pet.exp + 60;
      let newLevel = pet.level;
      let leveledUp = false;

      const reqExp = (lv) => lv * 100;
      while (newLevel < 30 && newExp >= reqExp(newLevel)) {
        newExp -= reqExp(newLevel);
        newLevel += 1;
        leveledUp = true;
      }

      this.db.run(
        `UPDATE pets SET hunger = ?, exp = ?, level = ?, last_fed_at = ? WHERE id = ?`,
        [newHunger, newExp, newLevel, now, pet.id]
      );

      return {
        pet: { ...pet, hunger: newHunger, exp: newExp, level: newLevel },
        species: PET_SPECIES[pet.species_id],
        usedBagFood,
        foodCost: usedBagFood ? 0 : foodCost,
        leveledUp,
      };
    });
  }

  /**
   * Huấn luyện / Tăng cấp trực tiếp cho thú cưng bằng VNĐ.
   */
  upgradePet(userId, username, petId = null, now = Date.now()) {
    return this.db.transaction(() => {
      const user = this.economySystem.ensureUser(userId, username, now);
      this.economySystem.assertCanTransact(user);

      const targetId = petId ?? user.active_pet_id;
      if (!targetId) throw new Error('Bạn chưa sở hữu hoặc chưa trang bị thú cưng.');

      const pet = this.db.get('SELECT * FROM pets WHERE id = ? AND user_id = ?', [
        targetId,
        String(userId),
      ]);
      if (!pet) throw new Error('Không tìm thấy thú cưng.');
      if (pet.level >= 30) throw new Error('Thú cưng đã đạt cấp độ tối đa (Cấp 30).');

      const upgradeCost = pet.level * 15_000;
      if (user.wallet < upgradeCost) {
        throw new Error(
          `Cần **${upgradeCost.toLocaleString('vi-VN')} VNĐ** để nâng cấp **${pet.nickname}** lên Cấp ${pet.level + 1}.`
        );
      }

      const nextWallet = user.wallet - upgradeCost;
      const nextLevel = pet.level + 1;

      this.db.run('UPDATE users SET wallet = ?, updated_at = ? WHERE user_id = ?', [
        nextWallet,
        now,
        String(userId),
      ]);
      this.db.run('UPDATE pets SET level = ?, exp = 0 WHERE id = ?', [
        nextLevel,
        pet.id,
      ]);
      this.db.run(
        `INSERT INTO transactions (user_id, type, amount, balance_after, note, created_at)
         VALUES (?, 'pet_upgrade', ?, ?, ?, ?)`,
        [String(userId), -upgradeCost, nextWallet, `Nâng cấp thú cưng ${pet.nickname} lên Lv.${nextLevel}`, now]
      );

      return {
        pet: { ...pet, level: nextLevel, exp: 0 },
        species: PET_SPECIES[pet.species_id],
        cost: upgradeCost,
        balanceAfter: nextWallet,
      };
    });
  }

  renamePet(userId, petId, newName) {
    const clean = String(newName || '').trim().slice(0, 28);
    if (clean.length < 2) {
      throw new Error('Tên thú cưng phải từ 2 đến 28 ký tự.');
    }
    const pet = this.db.get('SELECT * FROM pets WHERE id = ? AND user_id = ?', [
      petId,
      String(userId),
    ]);
    if (!pet) throw new Error('Không tìm thấy thú cưng thuộc sở hữu của bạn.');

    this.db.run('UPDATE pets SET nickname = ? WHERE id = ?', [clean, pet.id]);
    return { ...pet, nickname: clean };
  }

  equipPet(userId, petId) {
    const pet = this.db.get('SELECT * FROM pets WHERE id = ? AND user_id = ?', [
      petId,
      String(userId),
    ]);
    if (!pet) throw new Error('Không tìm thấy thú cưng thuộc sở hữu của bạn.');

    this.db.run('UPDATE users SET active_pet_id = ?, updated_at = ? WHERE user_id = ?', [
      pet.id,
      Date.now(),
      String(userId),
    ]);
    return { ...pet, species: PET_SPECIES[pet.species_id] };
  }
}
