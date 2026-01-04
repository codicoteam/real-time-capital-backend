const Asset = require("../models/asset.model");
const User = require("../models/user.model");
const Attachment = require("../models/attachment.model");
const Loan = require("../models/loan.model");

class AssetService {
  /**
   * Create a new asset
   */
  async createAsset(assetData, userId) {
    try {
      // Generate asset number if not provided
      if (!assetData.asset_no) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(1000 + Math.random() * 9000);
        assetData.asset_no = `AST${year}${month}${random}`;
      }

      // Set submitted by if not provided
      if (!assetData.submitted_by && userId) {
        assetData.submitted_by = userId;
      }

      // Validate category-specific fields
      this.validateAssetFields(assetData);

      const asset = new Asset(assetData);
      await asset.save();

      // Populate the necessary fields
      const populatedAsset = await asset.populate([
        { path: "owner_user", select: "first_name last_name email phone" },
        { path: "submitted_by", select: "first_name last_name email phone" },
      ]);

      return {
        success: true,
        data: populatedAsset,
        message: "Asset created successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get asset by ID with full population
   */
  async getAssetById(assetId) {
    try {
      const asset = await Asset.findById(assetId).populate([
        {
          path: "owner_user",
          select:
            "first_name last_name email phone profile_pic_url national_id_number address",
        },
        {
          path: "submitted_by",
          select: "first_name last_name email phone roles",
        },
        {
          path: "evaluated_by",
          select: "first_name last_name email phone roles",
        },
        {
          path: "attachments",
          select: "filename url mime_type category created_at",
        },
        {
          path: "active_loan",
          select: "loan_no principal_amount current_balance status due_date",
        },
      ]);

      if (!asset) {
        throw {
          status: 404,
          message: `Asset with ID ${assetId} not found`,
        };
      }

      return {
        success: true,
        data: asset,
        message: "Asset retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get assets with pagination
   */
  async getAssetsPaginated(
    filters = {},
    page = 1,
    limit = 10,
    sort = { created_at: -1 }
  ) {
    try {
      const skip = (page - 1) * limit;

      // Build query
      const query = {};

      if (filters.category) query.category = filters.category;
      if (filters.status) query.status = filters.status;
      if (filters.owner_user) query.owner_user = filters.owner_user;
      if (filters.asset_no)
        query.asset_no = { $regex: filters.asset_no, $options: "i" };
      if (filters.title) query.title = { $regex: filters.title, $options: "i" };

      // Date range filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      // Execute query with pagination
      const [assets, total] = await Promise.all([
        Asset.find(query)
          .populate([
            { path: "owner_user", select: "first_name last_name email phone" },
            { path: "submitted_by", select: "first_name last_name email" },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Asset.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          assets,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: "Assets retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all assets without pagination (for exports, reports, etc.)
   */
  async getAllAssets(filters = {}, sort = { created_at: -1 }) {
    try {
      const query = {};

      if (filters.category) query.category = filters.category;
      if (filters.status) query.status = filters.status;
      if (filters.owner_user) query.owner_user = filters.owner_user;
      if (filters.asset_no)
        query.asset_no = { $regex: filters.asset_no, $options: "i" };

      const assets = await Asset.find(query)
        .populate([
          { path: "owner_user", select: "first_name last_name email phone" },
          { path: "submitted_by", select: "first_name last_name email" },
          { path: "attachments", select: "filename url mime_type" },
        ])
        .sort(sort)
        .lean();

      return {
        success: true,
        data: assets,
        message: "All assets retrieved successfully",
        count: assets.length,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update asset
   */
  async updateAsset(assetId, updateData, userId) {
    try {
      // Check if asset exists
      const existingAsset = await Asset.findById(assetId);
      if (!existingAsset) {
        throw {
          status: 404,
          message: `Asset with ID ${assetId} not found`,
        };
      }

      // Prevent updating asset_no if provided
      if (
        updateData.asset_no &&
        updateData.asset_no !== existingAsset.asset_no
      ) {
        throw {
          status: 400,
          message: "Asset number cannot be changed",
        };
      }

      // Validate category-specific fields if category is being updated
      if (updateData.category) {
        this.validateAssetFields(updateData);
      }

      // Add audit trail
      updateData.updated_at = new Date();
      if (userId) {
        // You might want to track who updated in meta field
        updateData.$push = updateData.$push || {};
        updateData.$push.update_history = {
          updated_by: userId,
          updated_at: new Date(),
          changes: Object.keys(updateData).filter((k) => !k.startsWith("$")),
        };
      }

      const updatedAsset = await Asset.findByIdAndUpdate(assetId, updateData, {
        new: true,
        runValidators: true,
      }).populate([
        { path: "owner_user", select: "first_name last_name email phone" },
        { path: "submitted_by", select: "first_name last_name email" },
      ]);

      return {
        success: true,
        data: updatedAsset,
        message: "Asset updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update asset valuation
   */
  async updateValuation(assetId, valuationData, userId) {
    try {
      const asset = await Asset.findById(assetId);
      if (!asset) {
        throw {
          status: 404,
          message: `Asset with ID ${assetId} not found`,
        };
      }

      // Check if asset is in a state that allows valuation
      if (!["submitted", "valuating"].includes(asset.status)) {
        throw {
          status: 400,
          message: `Cannot update valuation for asset with status: ${asset.status}`,
        };
      }

      const updateData = {
        ...valuationData,
        evaluated_by: userId,
        evaluated_at: new Date(),
        status: "valuating", // Move to valuating status
      };

      const updatedAsset = await Asset.findByIdAndUpdate(assetId, updateData, {
        new: true,
        runValidators: true,
      }).populate([
        { path: "owner_user", select: "first_name last_name email phone" },
        { path: "evaluated_by", select: "first_name last_name email" },
      ]);

      return {
        success: true,
        data: updatedAsset,
        message: "Asset valuation updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete asset (soft delete by status change)
   */
  async deleteAsset(assetId, userId) {
    try {
      const asset = await Asset.findById(assetId);

      if (!asset) {
        throw {
          status: 404,
          message: `Asset with ID ${assetId} not found`,
        };
      }

      // Check if asset has active loan
      if (asset.active_loan) {
        throw {
          status: 400,
          message:
            "Cannot delete asset with active loan. Close the loan first.",
        };
      }

      // Soft delete by changing status
      asset.status = "closed";
      asset.updated_at = new Date();
      await asset.save();

      return {
        success: true,
        message: "Asset marked as closed successfully",
        data: { assetId },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update asset status
   */
  async updateStatus(assetId, status, notes = "", userId) {
    try {
      const validStatuses = [
        "submitted",
        "valuating",
        "pawned",
        "active",
        "overdue",
        "in_repair",
        "auction",
        "sold",
        "redeemed",
        "closed",
      ];

      if (!validStatuses.includes(status)) {
        throw {
          status: 400,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        };
      }

      const asset = await Asset.findById(assetId);
      if (!asset) {
        throw {
          status: 404,
          message: `Asset with ID ${assetId} not found`,
        };
      }

      // Add status history
      const statusUpdate = {
        status,
        updated_at: new Date(),
        $push: {
          status_history: {
            from: asset.status,
            to: status,
            changed_by: userId,
            changed_at: new Date(),
            notes,
          },
        },
      };

      const updatedAsset = await Asset.findByIdAndUpdate(
        assetId,
        statusUpdate,
        { new: true }
      ).populate([
        { path: "owner_user", select: "first_name last_name email phone" },
      ]);

      return {
        success: true,
        data: updatedAsset,
        message: `Asset status updated to ${status}`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get assets by owner
   */
  async getAssetsByOwner(ownerId, page = 1, limit = 10) {
    try {
      const user = await User.findById(ownerId);
      if (!user) {
        throw {
          status: 404,
          message: `User with ID ${ownerId} not found`,
        };
      }

      return this.getAssetsPaginated({ owner_user: ownerId }, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Search assets
   */
  async searchAssets(searchTerm, page = 1, limit = 10) {
    try {
      const query = {
        $or: [
          { asset_no: { $regex: searchTerm, $options: "i" } },
          { title: { $regex: searchTerm, $options: "i" } },
          { description: { $regex: searchTerm, $options: "i" } },
          { "electronics.brand": { $regex: searchTerm, $options: "i" } },
          { "electronics.model": { $regex: searchTerm, $options: "i" } },
          { "vehicle.make": { $regex: searchTerm, $options: "i" } },
          { "vehicle.model": { $regex: searchTerm, $options: "i" } },
          { "vehicle.registration_no": { $regex: searchTerm, $options: "i" } },
          { "jewellery.metal_type": { $regex: searchTerm, $options: "i" } },
        ],
      };

      return this.getAssetsPaginated(query, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Validate category-specific fields
   */
  validateAssetFields(assetData) {
    const { category, asset_type } = assetData;

    if (category === "electronics" && asset_type !== "ElectronicsAsset") {
      throw {
        status: 400,
        message:
          "For electronics category, asset_type must be 'ElectronicsAsset'",
      };
    }

    if (category === "vehicle" && asset_type !== "VehicleAsset") {
      throw {
        status: 400,
        message: "For vehicle category, asset_type must be 'VehicleAsset'",
      };
    }

    if (category === "jewellery" && asset_type !== "JewelleryAsset") {
      throw {
        status: 400,
        message: "For jewellery category, asset_type must be 'JewelleryAsset'",
      };
    }
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Asset Service Error:", error);

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

module.exports = new AssetService();
