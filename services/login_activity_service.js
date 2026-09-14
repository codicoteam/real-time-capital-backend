"use strict";

const LoginActivity = require("../models/login_activity.model");

class LoginActivityService {
  /**
   * Record a successful login. Called fire-and-forget from the login controllers —
   * never let a logging failure block an actual login, so swallow errors here too.
   */
  async recordLogin({ user_type, user_id, name, email, roles, ip, user_agent }) {
    try {
      if (!user_type || !user_id) return null;
      return await LoginActivity.create({
        user_type,
        user_id,
        name: name || null,
        email: email ? String(email).toLowerCase() : null,
        roles: Array.isArray(roles) ? roles : [],
        ip: ip || null,
        user_agent: user_agent || null,
        logged_in_at: new Date(),
      });
    } catch (error) {
      console.error("LoginActivityService.recordLogin error:", error.message);
      return null;
    }
  }

  /**
   * Paginated, filterable login history for the admin "Login Activity" tab.
   */
  async getLoginActivity(filters = {}, page = 1, limit = 25) {
    try {
      const { user_type, role, q, start, end } = filters;

      const query = {};
      if (user_type) query.user_type = user_type;
      if (role) query.roles = role;

      if (start || end) {
        query.logged_in_at = {};
        if (start) query.logged_in_at.$gte = new Date(start);
        if (end) query.logged_in_at.$lte = new Date(end);
      }

      if (q && q.trim().length >= 2) {
        const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [{ name: re }, { email: re }];
      }

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25));
      const skip = (pageNum - 1) * limitNum;

      const [items, total] = await Promise.all([
        LoginActivity.find(query)
          .sort({ logged_in_at: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        LoginActivity.countDocuments(query),
      ]);

      return {
        success: true,
        message: "Login activity retrieved successfully",
        data: {
          items,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1,
          },
        },
      };
    } catch (error) {
      throw { status: 500, message: error.message || "Failed to retrieve login activity" };
    }
  }

  /**
   * Quick stats header for the tab: today's logins, unique users today, and a
   * breakdown by population (staff/customer/investor) for the last 24 hours.
   * Pass { start, end } (e.g. from the daily digest's CAT day boundaries) to
   * compute over an explicit window instead of the server's local "today".
   */
  async getLoginStats({ start, end } = {}) {
    try {
      const startOfToday = start ? new Date(start) : new Date();
      if (!start) startOfToday.setHours(0, 0, 0, 0);
      const rangeMatch = end
        ? { logged_in_at: { $gte: startOfToday, $lte: new Date(end) } }
        : { logged_in_at: { $gte: startOfToday } };

      const [todayCount, uniqueToday, byType, totalAllTime] = await Promise.all([
        LoginActivity.countDocuments(rangeMatch),
        LoginActivity.distinct("user_id", rangeMatch),
        LoginActivity.aggregate([
          { $match: rangeMatch },
          {
            $group: {
              _id: {
                $cond: [
                  { $eq: ["$user_type", "investor"] },
                  "investor",
                  { $cond: [{ $in: ["customer", "$roles"] }, "customer", "staff"] },
                ],
              },
              count: { $sum: 1 },
            },
          },
        ]),
        LoginActivity.countDocuments({}),
      ]);

      const breakdown = { staff: 0, customer: 0, investor: 0 };
      byType.forEach((row) => {
        if (row._id in breakdown) breakdown[row._id] = row.count;
      });

      return {
        success: true,
        message: "Login stats retrieved successfully",
        data: {
          logins_today: todayCount,
          unique_users_today: uniqueToday.length,
          breakdown_today: breakdown,
          total_logins_recorded: totalAllTime,
        },
      };
    } catch (error) {
      throw { status: 500, message: error.message || "Failed to retrieve login stats" };
    }
  }
}

module.exports = new LoginActivityService();
