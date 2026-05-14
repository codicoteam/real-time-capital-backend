// services/auction_report_service.js
"use strict";

const mongoose = require("mongoose");
const Asset = require("../models/asset.model");
const Auction = require("../models/auction.model");
const Bid = require("../models/bid.model");
const BidPayment = require("../models/bidPayment.model");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DATE_RANGE_DAYS = 30;

/**
 * Asset statuses that belong to the auction pipeline.
 * We deliberately exclude "pawned", "active", "redeemed" (loan settled, not auctioned).
 */
const AUCTION_ASSET_STATUSES = ["auction", "sold"];

/** Auction statuses that generated revenue */
const CLOSED_AUCTION_STATUSES = ["closed"];

/** BidPayment statuses that represent real money received */
const PAID_PAYMENT_STATUSES = ["success"];

// ---------------------------------------------------------------------------

class AuctionReportService {
  /**
   * Generate the auction financial report for the given period.
   * @param {{ startDate?: string, endDate?: string }} options
   */
  async getAuctionReportData(options = {}) {
    const { startDate, endDate } = options;

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(now.getDate() - DEFAULT_DATE_RANGE_DAYS);

    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : now;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid startDate or endDate provided.");
    }
    if (start > end) {
      throw new Error("startDate must be before endDate.");
    }

    const [
      auctionSummary,
      bidSummary,
      paymentSummary,
      assetSummary,
      auctionsByStatus,
      auctionTrend,
      bidTrend,
      revenueTrend,
      collateralCategoryBreakdown,
      topAuctions,
      auctionList,
    ] = await Promise.all([
      this._getAuctionSummary(start, end),
      this._getBidSummary(start, end),
      this._getPaymentSummary(start, end),
      this._getAssetSummary(start, end),
      this._getAuctionsByStatus(start, end),
      this._getAuctionTrend(start, end),
      this._getBidTrend(start, end),
      this._getRevenueTrend(start, end),
      this._getCollateralCategoryBreakdown(start, end),
      this._getTopAuctions(start, end),
      this._getAuctionList(start, end),
    ]);

    return {
      success: true,
      data: {
        period: {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        },

        // ── Financial summary cards ──
        financial_summary: {
          // Auctions
          total_auctions: auctionSummary.total,
          live_auctions: auctionSummary.live,
          closed_auctions: auctionSummary.closed,
          cancelled_auctions: auctionSummary.cancelled,
          draft_auctions: auctionSummary.draft,

          // Revenue
          total_winning_bid_revenue: this._round(
            auctionSummary.total_winning_revenue,
          ),
          avg_winning_bid: this._round(auctionSummary.avg_winning_bid),
          highest_winning_bid: this._round(auctionSummary.highest_winning_bid),
          lowest_winning_bid: this._round(auctionSummary.lowest_winning_bid),

          // Bids
          total_bids_placed: bidSummary.total_bids,
          unique_bidders: bidSummary.unique_bidders,
          avg_bids_per_auction: this._round(bidSummary.avg_bids_per_auction),
          total_bid_value: this._round(bidSummary.total_bid_value),
          avg_bid_amount: this._round(bidSummary.avg_bid_amount),
          disputed_bids: bidSummary.disputed_bids,

          // Payments received
          total_payments_received: paymentSummary.total_received,
          total_payment_amount: this._round(paymentSummary.total_amount),
          total_refunded: this._round(paymentSummary.total_refunded),
          pending_payments: paymentSummary.pending,

          // Assets
          total_assets_in_auction: assetSummary.total_in_auction,
          total_assets_sold: assetSummary.total_sold,
          total_declared_value: this._round(assetSummary.total_declared_value),
          total_evaluated_value: this._round(
            assetSummary.total_evaluated_value,
          ),
          value_recovery_rate_percent: this._round(
            assetSummary.value_recovery_rate,
          ),
        },

        // ── 5 Charts ──
        charts: {
          // Chart 1: Auction creation + closing trend over time
          auction_trend: auctionTrend,

          // Chart 2: Daily bids placed + bid value over time
          bid_trend: bidTrend,

          // Chart 3: Revenue collected per day (winning bids + payments)
          revenue_trend: revenueTrend,

          // Chart 4: Auctions by status (doughnut/pie)
          auctions_by_status: auctionsByStatus,

          // Chart 5: Collateral category breakdown (assets in auction, sold, revenue)
          collateral_category_breakdown: collateralCategoryBreakdown,
        },

        // ── Supplementary breakdowns ──
        breakdowns: {
          auctions_by_status: auctionsByStatus,
          payment_by_method: paymentSummary.by_method,
          bid_payment_status_split: bidSummary.payment_status_split,
          top_auctions: topAuctions,
        },

        // ── Detailed auction list ──
        tables: {
          auctions: auctionList,
        },
      },
      message: "Auction financial report generated successfully.",
    };
  }

  // ─────────────────────── Private helpers ───────────────────────

  _round(val) {
    return Math.round((Number(val) || 0) * 100) / 100;
  }

  /**
   * Summary counts and revenue for auctions created in the period.
   * Only includes auctions whose asset is in the auction pipeline
   * (status "auction" or "sold") — excludes pawned/redeemed assets.
   */
  async _getAuctionSummary(start, end) {
    // Get auction IDs that belong to auction-pipeline assets only
    const auctionAssetIds = await Asset.find(
      { status: { $in: AUCTION_ASSET_STATUSES } },
      { _id: 1 },
    ).lean();
    const validAssetIds = auctionAssetIds.map((a) => a._id);

    const [result] = await Auction.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          asset: { $in: validAssetIds },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          live: { $sum: { $cond: [{ $eq: ["$status", "live"] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
          draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
          total_winning_revenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "closed"] },
                    { $gt: ["$winning_bid_amount", 0] },
                  ],
                },
                "$winning_bid_amount",
                0,
              ],
            },
          },
          avg_winning_bid: {
            $avg: {
              $cond: [
                { $eq: ["$status", "closed"] },
                "$winning_bid_amount",
                null,
              ],
            },
          },
          highest_winning_bid: { $max: "$winning_bid_amount" },
          lowest_winning_bid: {
            $min: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "closed"] },
                    { $gt: ["$winning_bid_amount", 0] },
                  ],
                },
                "$winning_bid_amount",
                null,
              ],
            },
          },
        },
      },
    ]);

    return (
      result || {
        total: 0,
        live: 0,
        closed: 0,
        cancelled: 0,
        draft: 0,
        total_winning_revenue: 0,
        avg_winning_bid: 0,
        highest_winning_bid: 0,
        lowest_winning_bid: 0,
      }
    );
  }

  /**
   * Bid statistics for bids placed in the period.
   */
  async _getBidSummary(start, end) {
    const [result] = await Bid.aggregate([
      { $match: { placed_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          total_bids: { $sum: 1 },
          total_bid_value: { $sum: "$amount" },
          avg_bid_amount: { $avg: "$amount" },
          unique_bidders: { $addToSet: "$bidder_user" },
          disputed_bids: {
            $sum: {
              $cond: [{ $ne: ["$dispute.status", "none"] }, 1, 0],
            },
          },
          // payment status split
          unpaid: {
            $sum: { $cond: [{ $eq: ["$payment_status", "unpaid"] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ["$payment_status", "pending"] }, 1, 0] },
          },
          paid: {
            $sum: { $cond: [{ $eq: ["$payment_status", "paid"] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ["$payment_status", "failed"] }, 1, 0] },
          },
          refunded: {
            $sum: { $cond: [{ $eq: ["$payment_status", "refunded"] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$payment_status", "cancelled"] }, 1, 0] },
          },
        },
      },
    ]);

    if (!result) {
      return {
        total_bids: 0,
        total_bid_value: 0,
        avg_bid_amount: 0,
        unique_bidders: 0,
        avg_bids_per_auction: 0,
        disputed_bids: 0,
        payment_status_split: {},
      };
    }

    // Avg bids per auction in the same period
    const auctionCount = await Auction.countDocuments({
      created_at: { $gte: start, $lte: end },
    });

    return {
      total_bids: result.total_bids,
      total_bid_value: result.total_bid_value,
      avg_bid_amount: result.avg_bid_amount,
      unique_bidders: (result.unique_bidders || []).length,
      avg_bids_per_auction:
        auctionCount > 0 ? result.total_bids / auctionCount : 0,
      disputed_bids: result.disputed_bids,
      payment_status_split: {
        unpaid: result.unpaid,
        pending: result.pending,
        paid: result.paid,
        failed: result.failed,
        refunded: result.refunded,
        cancelled: result.cancelled,
      },
    };
  }

  /**
   * BidPayment totals for payments created in the period.
   */
  async _getPaymentSummary(start, end) {
    const [result] = await BidPayment.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          total_received: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          total_amount: {
            $sum: {
              $cond: [{ $eq: ["$status", "success"] }, "$amount", 0],
            },
          },
          total_refunded: {
            $sum: {
              $cond: [{ $eq: ["$status", "refunded"] }, "$amount", 0],
            },
          },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
        },
      },
    ]);

    // Payment method breakdown
    const byMethod = await BidPayment.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          status: "success",
        },
      },
      {
        $group: {
          _id: "$method",
          count: { $sum: 1 },
          total: { $sum: "$amount" },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const by_method = byMethod.reduce((acc, r) => {
      acc[r._id || "unknown"] = {
        count: r.count,
        total: this._round(r.total),
      };
      return acc;
    }, {});

    return result
      ? {
          total_received: result.total_received,
          total_amount: result.total_amount,
          total_refunded: result.total_refunded,
          pending: result.pending,
          by_method,
        }
      : {
          total_received: 0,
          total_amount: 0,
          total_refunded: 0,
          pending: 0,
          by_method: {},
        };
  }

  /**
   * Assets that are in/were in the auction pipeline (status auction or sold)
   * created or updated in the period.
   *
   * value_recovery_rate = (total winning bid revenue / total evaluated value) * 100
   * We get winning bid revenue by joining with Auction via active_loan cross-ref
   * or directly by looking at sold assets linked to closed auctions.
   */
  async _getAssetSummary(start, end) {
    const [result] = await Asset.aggregate([
      {
        $match: {
          status: { $in: AUCTION_ASSET_STATUSES },
          updated_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          total_in_auction: {
            $sum: { $cond: [{ $eq: ["$status", "auction"] }, 1, 0] },
          },
          total_sold: {
            $sum: { $cond: [{ $eq: ["$status", "sold"] }, 1, 0] },
          },
          total_declared_value: { $sum: { $ifNull: ["$declared_value", 0] } },
          total_evaluated_value: { $sum: { $ifNull: ["$evaluated_value", 0] } },
        },
      },
    ]);

    if (!result) {
      return {
        total_in_auction: 0,
        total_sold: 0,
        total_declared_value: 0,
        total_evaluated_value: 0,
        value_recovery_rate: 0,
      };
    }

    // Revenue from closed auctions in the period (winning bids)
    const [revenueResult] = await Auction.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          status: "closed",
          winning_bid_amount: { $gt: 0 },
        },
      },
      { $group: { _id: null, total_revenue: { $sum: "$winning_bid_amount" } } },
    ]);

    const totalRevenue = revenueResult?.total_revenue || 0;
    const evalValue = result.total_evaluated_value || 0;
    const valueRecoveryRate =
      evalValue > 0 ? (totalRevenue / evalValue) * 100 : 0;

    return {
      ...result,
      value_recovery_rate: valueRecoveryRate,
    };
  }

  /**
   * Chart 3: Count of auctions by status in the period (for pie/doughnut).
   */
  async _getAuctionsByStatus(start, end) {
    const rows = await Auction.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return {
      labels: rows.map((r) => r._id),
      data: rows.map((r) => r.count),
      raw: rows.reduce((acc, r) => {
        acc[r._id] = r.count;
        return acc;
      }, {}),
    };
  }

  /**
   * Chart 1: Daily auctions created and closed in the period.
   */
  async _getAuctionTrend(start, end) {
    const [created, closed] = await Promise.all([
      Auction.aggregate([
        { $match: { created_at: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
            count: { $sum: 1 },
            starting_bid_total: { $sum: "$starting_bid_amount" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Auction.aggregate([
        {
          $match: {
            ends_at: { $gte: start, $lte: end },
            status: "closed",
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$ends_at" } },
            count: { $sum: 1 },
            total_revenue: { $sum: "$winning_bid_amount" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const labels = Array.from(
      new Set([...created.map((r) => r._id), ...closed.map((r) => r._id)]),
    ).sort();

    return {
      labels,
      datasets: [
        {
          label: "Auctions Created",
          data: labels.map((d) => created.find((r) => r._id === d)?.count || 0),
        },
        {
          label: "Auctions Closed",
          data: labels.map((d) => closed.find((r) => r._id === d)?.count || 0),
        },
        {
          label: "Revenue from Closed Auctions (USD)",
          data: labels.map((d) =>
            this._round(closed.find((r) => r._id === d)?.total_revenue || 0),
          ),
          yAxisID: "amount",
        },
      ],
    };
  }

  /**
   * Chart 2: Daily bids placed + total bid value in the period.
   */
  async _getBidTrend(start, end) {
    const rows = await Bid.aggregate([
      { $match: { placed_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$placed_at" } },
          bid_count: { $sum: 1 },
          total_value: { $sum: "$amount" },
          unique_bidders: { $addToSet: "$bidder_user" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      labels: rows.map((r) => r._id),
      datasets: [
        {
          label: "Bids Placed",
          data: rows.map((r) => r.bid_count),
        },
        {
          label: "Total Bid Value (USD)",
          data: rows.map((r) => this._round(r.total_value)),
          yAxisID: "amount",
        },
        {
          label: "Unique Bidders",
          data: rows.map((r) => (r.unique_bidders || []).length),
          yAxisID: "count",
        },
      ],
    };
  }

  /**
   * Chart 4 (Revenue Trend): Daily BidPayment success amounts in the period.
   */
  async _getRevenueTrend(start, end) {
    const rows = await BidPayment.aggregate([
      {
        $match: {
          paid_at: { $gte: start, $lte: end },
          status: "success",
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$paid_at" } },
          total_collected: { $sum: "$amount" },
          payment_count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Cumulative revenue
    let cumulative = 0;
    const cumulativeData = rows.map((r) => {
      cumulative += r.total_collected;
      return this._round(cumulative);
    });

    return {
      labels: rows.map((r) => r._id),
      datasets: [
        {
          label: "Daily Revenue Collected (USD)",
          data: rows.map((r) => this._round(r.total_collected)),
        },
        {
          label: "Cumulative Revenue (USD)",
          data: cumulativeData,
        },
        {
          label: "Payments Count",
          data: rows.map((r) => r.payment_count),
          yAxisID: "count",
        },
      ],
    };
  }

  /**
   * Chart 5: Collateral category breakdown for assets in the auction pipeline.
   * Shows: count of assets, total declared value, total evaluated value,
   * and total winning bid revenue per category.
   */
  async _getCollateralCategoryBreakdown(start, end) {
    // Assets in auction pipeline updated in period
    const assetRows = await Asset.aggregate([
      {
        $match: {
          status: { $in: AUCTION_ASSET_STATUSES },
          updated_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: "$category",
          asset_count: { $sum: 1 },
          total_declared: { $sum: { $ifNull: ["$declared_value", 0] } },
          total_evaluated: { $sum: { $ifNull: ["$evaluated_value", 0] } },
          asset_ids: { $push: "$_id" },
        },
      },
      { $sort: { asset_count: -1 } },
    ]);

    // For each category, sum winning bids from closed auctions for those assets
    const enriched = await Promise.all(
      assetRows.map(async (row) => {
        const [rev] = await Auction.aggregate([
          {
            $match: {
              asset: { $in: row.asset_ids },
              status: "closed",
              winning_bid_amount: { $gt: 0 },
              created_at: { $gte: start, $lte: end },
            },
          },
          { $group: { _id: null, revenue: { $sum: "$winning_bid_amount" } } },
        ]);

        return {
          category: row._id,
          asset_count: row.asset_count,
          total_declared_value: this._round(row.total_declared),
          total_evaluated_value: this._round(row.total_evaluated),
          total_winning_revenue: this._round(rev?.revenue || 0),
        };
      }),
    );

    const labels = enriched.map((r) => r.category);

    return {
      labels,
      datasets: [
        {
          label: "Asset Count",
          data: enriched.map((r) => r.asset_count),
        },
        {
          label: "Total Evaluated Value (USD)",
          data: enriched.map((r) => r.total_evaluated_value),
          yAxisID: "amount",
        },
        {
          label: "Total Winning Revenue (USD)",
          data: enriched.map((r) => r.total_winning_revenue),
          yAxisID: "amount",
        },
      ],
      raw: enriched,
    };
  }

  /**
   * Top 10 auctions by winning bid amount in the period.
   */
  async _getTopAuctions(start, end) {
    const rows = await Auction.find({
      created_at: { $gte: start, $lte: end },
      status: "closed",
      winning_bid_amount: { $gt: 0 },
    })
      .sort({ winning_bid_amount: -1 })
      .limit(10)
      .populate(
        "asset",
        "title category asset_no declared_value evaluated_value status",
      )
      .populate(
        "winner_user",
        "first_name last_name email phone national_id_number",
      )
      .populate("created_by", "first_name last_name")
      .lean();

    return rows.map((a) => ({
      auction_id: a._id,
      auction_no: a.auction_no,
      status: a.status,
      auction_type: a.auction_type,
      starting_bid_amount: this._round(a.starting_bid_amount),
      reserve_price: this._round(a.reserve_price),
      winning_bid_amount: this._round(a.winning_bid_amount),
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      asset: a.asset
        ? {
            id: a.asset._id,
            asset_no: a.asset.asset_no,
            title: a.asset.title,
            category: a.asset.category,
            declared_value: this._round(a.asset.declared_value),
            evaluated_value: this._round(a.asset.evaluated_value),
            status: a.asset.status,
          }
        : null,
      winner: a.winner_user
        ? {
            id: a.winner_user._id,
            full_name:
              `${a.winner_user.first_name || ""} ${a.winner_user.last_name || ""}`.trim(),
            email: a.winner_user.email,
            phone: a.winner_user.phone,
            national_id_number: a.winner_user.national_id_number,
          }
        : null,
    }));
  }

  /**
   * Full auction list for the period, populated with asset + winner + bid count.
   * Only includes auctions whose linked asset is in the auction pipeline
   * (status "auction" or "sold") — pawned/redeemed assets are excluded.
   */
  async _getAuctionList(start, end) {
    // Fetch auction-pipeline asset IDs
    const auctionAssets = await Asset.find(
      { status: { $in: AUCTION_ASSET_STATUSES } },
      { _id: 1 },
    ).lean();
    const validAssetIds = auctionAssets.map((a) => a._id);

    const auctions = await Auction.find({
      created_at: { $gte: start, $lte: end },
      asset: { $in: validAssetIds },
    })
      .sort({ created_at: -1 })
      .populate(
        "asset",
        "title category asset_no declared_value evaluated_value status condition storage_location",
      )
      .populate(
        "winner_user",
        "first_name last_name email phone national_id_number profile_pic_url",
      )
      .populate("created_by", "first_name last_name email")
      .lean();

    // Get bid counts per auction in one query
    const auctionIds = auctions.map((a) => a._id);
    const bidCounts = await Bid.aggregate([
      { $match: { auction: { $in: auctionIds } } },
      {
        $group: {
          _id: "$auction",
          count: { $sum: 1 },
          highest_bid: { $max: "$amount" },
        },
      },
    ]);
    const bidCountMap = bidCounts.reduce((acc, r) => {
      acc[r._id.toString()] = { count: r.count, highest_bid: r.highest_bid };
      return acc;
    }, {});

    // Get payment totals per auction
    const payments = await BidPayment.aggregate([
      {
        $match: {
          auction: { $in: auctionIds },
          status: "success",
        },
      },
      {
        $group: {
          _id: "$auction",
          total_paid: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
    const paymentMap = payments.reduce((acc, r) => {
      acc[r._id.toString()] = { total_paid: r.total_paid, count: r.count };
      return acc;
    }, {});

    return auctions.map((a) => {
      const bidInfo = bidCountMap[a._id.toString()] || {
        count: 0,
        highest_bid: 0,
      };
      const payInfo = paymentMap[a._id.toString()] || {
        total_paid: 0,
        count: 0,
      };
      const asset = a.asset || {};

      return {
        auction_id: a._id,
        auction_no: a.auction_no,
        status: a.status,
        auction_type: a.auction_type,
        starting_bid_amount: this._round(a.starting_bid_amount),
        reserve_price: this._round(a.reserve_price),
        winning_bid_amount: this._round(a.winning_bid_amount),
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        created_at: a.created_at,

        // Bid stats
        total_bids: bidInfo.count,
        highest_bid: this._round(bidInfo.highest_bid),

        // Payment stats
        total_payment_collected: this._round(payInfo.total_paid),
        payment_count: payInfo.count,

        // Asset
        asset: {
          id: asset._id,
          asset_no: asset.asset_no,
          title: asset.title,
          category: asset.category,
          condition: asset.condition,
          storage_location: asset.storage_location,
          declared_value: this._round(asset.declared_value),
          evaluated_value: this._round(asset.evaluated_value),
          status: asset.status,
        },

        // Winner (if closed)
        winner: a.winner_user
          ? {
              id: a.winner_user._id,
              full_name:
                `${a.winner_user.first_name || ""} ${a.winner_user.last_name || ""}`.trim(),
              email: a.winner_user.email,
              phone: a.winner_user.phone,
              national_id_number: a.winner_user.national_id_number,
              profile_pic_url: a.winner_user.profile_pic_url,
            }
          : null,

        // Created by
        created_by: a.created_by
          ? {
              id: a.created_by._id,
              full_name:
                `${a.created_by.first_name || ""} ${a.created_by.last_name || ""}`.trim(),
              email: a.created_by.email,
            }
          : null,
      };
    });
  }
}

module.exports = new AuctionReportService();
