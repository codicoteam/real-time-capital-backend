const assetService = require("../services/asset_service");

class AssetController {
  /**
   * Create a new asset
   */
  async createAsset(req, res) {
    try {
      const assetData = req.body;
      const userId = req.user?.id; // Assuming user is authenticated

      const result = await assetService.createAsset(assetData, userId);

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create asset",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Get asset by ID
   */
  async getAsset(req, res) {
    try {
      const { id } = req.params;

      const result = await assetService.getAssetById(id);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve asset",
        detail: error.detail,
      });
    }
  }

  /**
   * Get assets with pagination
   */
  async getAssets(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        category,
        status,
        owner_user,
        asset_no,
        title,
        created_from,
        created_to,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      // Parse page and limit
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Validate pagination params
      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100",
        });
      }

      // Build sort object
      const sort = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      // Build filters
      const filters = {
        category,
        status,
        owner_user,
        asset_no,
        title,
        created_from,
        created_to,
      };

      const result = await assetService.getAssetsPaginated(
        filters,
        pageNum,
        limitNum,
        sort
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve assets",
        detail: error.detail,
      });
    }
  }

  /**
   * Get all assets without pagination
   */
  async getAllAssets(req, res) {
    try {
      const {
        category,
        status,
        owner_user,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      // Build sort object
      const sort = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      // Build filters
      const filters = { category, status, owner_user };

      const result = await assetService.getAllAssets(filters, sort);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        count: result.count,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve assets",
        detail: error.detail,
      });
    }
  }

  /**
   * Update asset
   */
  async updateAsset(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      const result = await assetService.updateAsset(id, updateData, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update asset",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Update asset valuation
   */
  async updateValuation(req, res) {
    try {
      const { id } = req.params;
      const valuationData = req.body;
      const userId = req.user?.id;

      const result = await assetService.updateValuation(
        id,
        valuationData,
        userId
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update valuation",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Delete asset (soft delete)
   */
  async deleteAsset(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const result = await assetService.deleteAsset(id, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete asset",
        detail: error.detail,
      });
    }
  }

  /**
   * Update asset status
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const userId = req.user?.id;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      const result = await assetService.updateStatus(id, status, notes, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update status",
        detail: error.detail,
      });
    }
  }

  /**
   * Get assets by owner
   */
  async getAssetsByOwner(req, res) {
    try {
      const { ownerId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await assetService.getAssetsByOwner(
        ownerId,
        pageNum,
        limitNum
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve assets by owner",
        detail: error.detail,
      });
    }
  }

  /**
   * Search assets
   */
  async searchAssets(req, res) {
    try {
      const { q } = req.query;
      const { page = 1, limit = 10 } = req.query;

      if (!q || q.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search term must be at least 2 characters long",
        });
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await assetService.searchAssets(
        q.trim(),
        pageNum,
        limitNum
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to search assets",
        detail: error.detail,
      });
    }
  }

  /**
   * Get asset statistics
   */
  async getAssetStats(req, res) {
    try {
      const stats = await assetService.getAssetStats();

      res.status(200).json({
        success: true,
        message: "Asset statistics retrieved successfully",
        data: stats,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve asset statistics",
        detail: error.detail,
      });
    }
  }
}

module.exports = new AssetController();
