const AssetValuation = require("../models/assetValuation.model");
const Asset = require("../models/asset.model");
const User = require("../models/user.model");
const Attachment = require("../models/attachment.model");

class AssetValuationService {
  /**
   * Create a new asset valuation request
   */
  async createValuation(valuationData, userId) {
    try {
      // Validate asset exists
      const asset = await Asset.findById(valuationData.asset);
      if (!asset) {
        throw {
          status: 404,
          message: `Asset with ID ${valuationData.asset} not found`,
        };
      }

      // Validate requested_by user exists
      if (valuationData.requested_by) {
        const requester = await User.findById(valuationData.requested_by);
        if (!requester) {
          throw {
            status: 404,
            message: `Requester user with ID ${valuationData.requested_by} not found`,
          };
        }
      } else {
        valuationData.requested_by = userId;
      }

      // Set requested_at if not provided
      if (!valuationData.requested_at) {
        valuationData.requested_at = new Date();
      }

      // Set assessment_date if not provided (required by BRS)
      if (!valuationData.assessment_date) {
        valuationData.assessment_date = new Date();
      }

      // For final stage, validate required fields
      if (valuationData.stage === "final") {
        if (!valuationData.desired_loan_amount) {
          throw {
            status: 400,
            message: "desired_loan_amount is required for final valuation",
          };
        }
        if (!valuationData.comments) {
          throw {
            status: 400,
            message: "comments are required for final valuation",
          };
        }
      }

      // Calculate estimated loan value based on BRS rules
      if (
        valuationData.estimated_market_value &&
        !valuationData.estimated_loan_value
      ) {
        valuationData.estimated_loan_value = this.calculateEstimatedLoanValue(
          valuationData.estimated_market_value,
          asset.category
        );
      }

      const valuation = new AssetValuation(valuationData);
      await valuation.save();

      // Populate necessary fields
      const populatedValuation = await valuation.populate([
        {
          path: "asset",
          select:
            "asset_no title category condition evaluated_value declared_value status",
        },
        {
          path: "requested_by",
          select: "first_name last_name email phone roles",
        },
        {
          path: "valued_by_user",
          select: "first_name last_name email phone roles",
        },
        {
          path: "attachments",
          select: "filename url mime_type category",
        },
      ]);

      // Update asset status if valuation is being requested
      if (asset.status === "submitted" && valuationData.stage === "market") {
        await Asset.findByIdAndUpdate(valuationData.asset, {
          status: "valuating",
        });
      }

      return {
        success: true,
        data: populatedValuation,
        message: "Valuation request created successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get valuation by ID with full population
   */
  async getValuationById(valuationId) {
    try {
      const valuation = await AssetValuation.findById(valuationId).populate([
        {
          path: "asset",
          select:
            "asset_no title category condition declared_value evaluated_value storage_location attachments owner_user submitted_by",
          populate: [
            {
              path: "owner_user",
              select: "first_name last_name email phone national_id_number",
            },
            {
              path: "submitted_by",
              select: "first_name last_name email phone",
            },
          ],
        },
        {
          path: "requested_by",
          select: "first_name last_name email phone roles",
        },
        {
          path: "valued_by_user",
          select: "first_name last_name email phone roles",
        },
        {
          path: "attachments",
          select: "filename url mime_type category uploaded_at",
        },
      ]);

      if (!valuation) {
        throw {
          status: 404,
          message: `Valuation with ID ${valuationId} not found`,
        };
      }

      return {
        success: true,
        data: valuation,
        message: "Valuation retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get valuations with pagination
   */
  async getValuationsPaginated(
    filters = {},
    page = 1,
    limit = 10,
    sort = { created_at: -1 }
  ) {
    try {
      const skip = (page - 1) * limit;

      // Build query
      const query = {};

      if (filters.asset) query.asset = filters.asset;
      if (filters.stage) query.stage = filters.stage;
      if (filters.status) query.status = filters.status;
      if (filters.requested_by) query.requested_by = filters.requested_by;
      if (filters.valued_by_user) query.valued_by_user = filters.valued_by_user;

      // Date range filters
      if (filters.requested_from || filters.requested_to) {
        query.requested_at = {};
        if (filters.requested_from)
          query.requested_at.$gte = new Date(filters.requested_from);
        if (filters.requested_to)
          query.requested_at.$lte = new Date(filters.requested_to);
      }

      if (filters.assessment_from || filters.assessment_to) {
        query.assessment_date = {};
        if (filters.assessment_from)
          query.assessment_date.$gte = new Date(filters.assessment_from);
        if (filters.assessment_to)
          query.assessment_date.$lte = new Date(filters.assessment_to);
      }

      // Value range filters
      if (filters.min_market_value || filters.max_market_value) {
        query.estimated_market_value = {};
        if (filters.min_market_value)
          query.estimated_market_value.$gte = parseFloat(
            filters.min_market_value
          );
        if (filters.max_market_value)
          query.estimated_market_value.$lte = parseFloat(
            filters.max_market_value
          );
      }

      if (filters.min_loan_value || filters.max_loan_value) {
        query.estimated_loan_value = {};
        if (filters.min_loan_value)
          query.estimated_loan_value.$gte = parseFloat(filters.min_loan_value);
        if (filters.max_loan_value)
          query.estimated_loan_value.$lte = parseFloat(filters.max_loan_value);
      }

      // Execute query with pagination
      const [valuations, total] = await Promise.all([
        AssetValuation.find(query)
          .populate([
            {
              path: "asset",
              select: "asset_no title category evaluated_value status",
              populate: {
                path: "owner_user",
                select: "first_name last_name",
              },
            },
            {
              path: "requested_by",
              select: "first_name last_name",
            },
            {
              path: "valued_by_user",
              select: "first_name last_name",
            },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        AssetValuation.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          valuations,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: "Valuations retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all valuations without pagination (for exports, reports, etc.)
   */
  async getAllValuations(filters = {}, sort = { created_at: -1 }) {
    try {
      const query = {};

      if (filters.asset) query.asset = filters.asset;
      if (filters.stage) query.stage = filters.stage;
      if (filters.status) query.status = filters.status;
      if (filters.requested_by) query.requested_by = filters.requested_by;

      const valuations = await AssetValuation.find(query)
        .populate([
          {
            path: "asset",
            select: "asset_no title category evaluated_value",
            populate: {
              path: "owner_user",
              select: "first_name last_name email",
            },
          },
          {
            path: "requested_by",
            select: "first_name last_name email",
          },
          {
            path: "valued_by_user",
            select: "first_name last_name email",
          },
        ])
        .sort(sort)
        .lean();

      return {
        success: true,
        data: valuations,
        message: "All valuations retrieved successfully",
        count: valuations.length,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update valuation
   */
  async updateValuation(valuationId, updateData, userId) {
    try {
      // Check if valuation exists
      const existingValuation = await AssetValuation.findById(valuationId);
      if (!existingValuation) {
        throw {
          status: 404,
          message: `Valuation with ID ${valuationId} not found`,
        };
      }

      // Check if valuation can be updated
      if (
        existingValuation.status === "completed" ||
        existingValuation.status === "rejected"
      ) {
        throw {
          status: 400,
          message: `Cannot update valuation with status: ${existingValuation.status}`,
        };
      }

      // If updating to final stage, validate required fields
      if (updateData.stage === "final" || existingValuation.stage === "final") {
        if (!updateData.final_value && !existingValuation.final_value) {
          throw {
            status: 400,
            message: "final_value is required for final stage valuation",
          };
        }
        if (!updateData.comments && !existingValuation.comments) {
          throw {
            status: 400,
            message: "comments are required for final stage valuation",
          };
        }
      }

      // Update asset's evaluated_value when valuation is completed
      if (updateData.status === "completed" && updateData.final_value) {
        const asset = await Asset.findById(existingValuation.asset);
        if (asset) {
          await Asset.findByIdAndUpdate(asset._id, {
            evaluated_value: updateData.final_value,
            evaluated_by: userId,
            evaluated_at: new Date(),
            status: "active", // Asset becomes available for loan after valuation
          });
        }
      }

      // Update valued_by_user if not set and user is updating
      if (
        !updateData.valued_by_user &&
        userId &&
        existingValuation.stage === updateData.stage
      ) {
        updateData.valued_by_user = userId;
      }

      const updatedValuation = await AssetValuation.findByIdAndUpdate(
        valuationId,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      ).populate([
        {
          path: "asset",
          select: "asset_no title category evaluated_value",
        },
        {
          path: "requested_by",
          select: "first_name last_name",
        },
        {
          path: "valued_by_user",
          select: "first_name last_name",
        },
      ]);

      return {
        success: true,
        data: updatedValuation,
        message: "Valuation updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update valuation status
   */
  async updateValuationStatus(valuationId, status, userId, notes = "") {
    try {
      const validStatuses = [
        "requested",
        "in_progress",
        "completed",
        "rejected",
      ];

      if (!validStatuses.includes(status)) {
        throw {
          status: 400,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        };
      }

      const valuation = await AssetValuation.findById(valuationId);
      if (!valuation) {
        throw {
          status: 404,
          message: `Valuation with ID ${valuationId} not found`,
        };
      }

      // Status transition validations
      this.validateValuationStatusTransition(valuation.status, status);

      const updateData = {
        status,
        updated_at: new Date(),
      };

      // Set valued_by_user when status changes to in_progress or completed
      if (
        (status === "in_progress" || status === "completed") &&
        !valuation.valued_by_user
      ) {
        updateData.valued_by_user = userId;
      }

      // Update asset evaluated_value when valuation is completed
      if (status === "completed" && valuation.final_value) {
        await Asset.findByIdAndUpdate(valuation.asset, {
          evaluated_value: valuation.final_value,
          evaluated_by: userId,
          evaluated_at: new Date(),
          status: "active",
        });
      }

      const updatedValuation = await AssetValuation.findByIdAndUpdate(
        valuationId,
        updateData,
        { new: true }
      ).populate([
        { path: "asset", select: "asset_no title category" },
        { path: "requested_by", select: "first_name last_name" },
      ]);

      return {
        success: true,
        data: updatedValuation,
        message: `Valuation status updated to ${status}`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete valuation
   */
  async deleteValuation(valuationId, userId) {
    try {
      const valuation = await AssetValuation.findById(valuationId);

      if (!valuation) {
        throw {
          status: 404,
          message: `Valuation with ID ${valuationId} not found`,
        };
      }

      // Check if valuation can be deleted
      if (valuation.status === "completed") {
        throw {
          status: 400,
          message: "Cannot delete completed valuation",
        };
      }

      // Update asset status back to submitted if it was valuating
      if (valuation.asset) {
        const asset = await Asset.findById(valuation.asset);
        if (asset && asset.status === "valuating") {
          await Asset.findByIdAndUpdate(valuation.asset, {
            status: "submitted",
          });
        }
      }

      await AssetValuation.findByIdAndDelete(valuationId);

      return {
        success: true,
        message: "Valuation deleted successfully",
        data: { valuationId },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get valuations by asset ID
   */
  async getValuationsByAsset(assetId, page = 1, limit = 10) {
    try {
      const asset = await Asset.findById(assetId);
      if (!asset) {
        throw {
          status: 404,
          message: `Asset with ID ${assetId} not found`,
        };
      }

      return this.getValuationsPaginated({ asset: assetId }, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Search valuations
   */
  async searchValuations(searchTerm, page = 1, limit = 10) {
    try {
      if (searchTerm.length < 2) {
        throw {
          status: 400,
          message: "Search term must be at least 2 characters",
        };
      }

      // Try to find assets matching search term
      const assets = await Asset.find({
        $or: [
          { asset_no: { $regex: searchTerm, $options: "i" } },
          { title: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      const query = {
        $or: [],
      };

      if (assets.length > 0) {
        query.$or.push({ asset: { $in: assets.map((a) => a._id) } });
      }

      // Also search in valuation comments
      query.$or.push({ comments: { $regex: searchTerm, $options: "i" } });

      return this.getValuationsPaginated(query, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get valuation statistics
   */
  async getValuationStats() {
    try {
      const total = await AssetValuation.countDocuments();

      const byStage = await AssetValuation.aggregate([
        { $group: { _id: "$stage", count: { $sum: 1 } } },
      ]);

      const byStatus = await AssetValuation.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      const byCategory = await AssetValuation.aggregate([
        {
          $lookup: {
            from: "assets",
            localField: "asset",
            foreignField: "_id",
            as: "asset_info",
          },
        },
        { $unwind: "$asset_info" },
        { $group: { _id: "$asset_info.category", count: { $sum: 1 } } },
      ]);

      // Calculate average market and loan values
      const valueStats = await AssetValuation.aggregate([
        {
          $match: {
            estimated_market_value: { $gt: 0 },
            estimated_loan_value: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            avg_market_value: { $avg: "$estimated_market_value" },
            avg_loan_value: { $avg: "$estimated_loan_value" },
            total_market_value: { $sum: "$estimated_market_value" },
            total_loan_value: { $sum: "$estimated_loan_value" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Convert aggregates to objects
      const stageStats = {};
      byStage.forEach((item) => {
        stageStats[item._id] = item.count;
      });

      const statusStats = {};
      byStatus.forEach((item) => {
        statusStats[item._id] = item.count;
      });

      const categoryStats = {};
      byCategory.forEach((item) => {
        categoryStats[item._id] = item.count;
      });

      return {
        total,
        by_stage: stageStats,
        by_status: statusStats,
        by_category: categoryStats,
        value_statistics: valueStats[0] || {
          avg_market_value: 0,
          avg_loan_value: 0,
          total_market_value: 0,
          total_loan_value: 0,
          count: 0,
        },
        pending_valuations: statusStats.requested || 0,
        completed_valuations: statusStats.completed || 0,
        in_progress_valuations: statusStats.in_progress || 0,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get valuations by customer (owner)
   */
  async getValuationsByCustomer(customerId, page = 1, limit = 10) {
    try {
      // Find assets owned by customer
      const customerAssets = await Asset.find({
        owner_user: customerId,
      }).select("_id");

      if (customerAssets.length === 0) {
        return {
          success: true,
          data: {
            valuations: [],
            pagination: {
              total: 0,
              page,
              limit,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: false,
            },
          },
          message: "No valuations found for this customer",
        };
      }

      const assetIds = customerAssets.map((asset) => asset._id);

      return this.getValuationsPaginated(
        { asset: { $in: assetIds } },
        page,
        limit
      );
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate estimated loan value based on BRS rules
   */
  calculateEstimatedLoanValue(marketValue, category) {
    let percentage = 30; // Default 30% for most items

    // BRS rule: 50% for certain high-value categories
    if (category === "vehicle" || category === "jewellery") {
      percentage = 50;
    }

    const loanValue = (marketValue * percentage) / 100;
    return Math.round(loanValue * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Validate valuation status transition
   */
  validateValuationStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      requested: ["in_progress", "rejected"],
      in_progress: ["completed", "rejected"],
      completed: [], // Cannot change from completed
      rejected: [], // Cannot change from rejected
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw {
        status: 400,
        message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
      };
    }
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Asset Valuation Service Error:", error);

    // If it's already a custom error, return it
    if (error.status && error.message) {
      return error;
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return {
        status: 409,
        message: `${field.replace("_", " ")} already exists`,
        field,
      };
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return {
        status: 400,
        message: "Validation failed",
        errors,
      };
    }

    // Handle CastError (invalid ObjectId)
    if (error.name === "CastError") {
      return {
        status: 400,
        message: `Invalid ${error.path}: ${error.value}`,
      };
    }

    // Default error
    return {
      status: 500,
      message: "Internal server error",
      detail: error.message,
    };
  }
}

module.exports = new AssetValuationService();
