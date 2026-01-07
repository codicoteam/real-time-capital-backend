const assetValuationService = require("../services/asset_valuation_service");

class AssetValuationController {
  /**
   * Create a new asset valuation
   */
  async createValuation(req, res) {
    try {
      const valuationData = req.body;
      const userId = req.user._id;

      const result = await assetValuationService.createValuation(
        valuationData,
        userId
      );

      res.status(201).json(result);
    } catch (error) {
      console.error("Create Valuation Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to create valuation",
        errors: error.errors || null,
      });
    }
  }

  /**
   * Get valuation by ID
   */
  async getValuation(req, res) {
    try {
      const { id } = req.params;

      const result = await assetValuationService.getValuationById(id);

      res.status(200).json(result);
    } catch (error) {
      console.error("Get Valuation Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to get valuation",
      });
    }
  }

  /**
   * Get valuations with pagination
   */
  async getValuations(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        asset,
        stage,
        status,
        requested_by,
        valued_by_user,
        requested_from,
        requested_to,
        assessment_from,
        assessment_to,
        min_market_value,
        max_market_value,
        min_loan_value,
        max_loan_value,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      const filters = {
        asset,
        stage,
        status,
        requested_by,
        valued_by_user,
        requested_from,
        requested_to,
        assessment_from,
        assessment_to,
        min_market_value,
        max_market_value,
        min_loan_value,
        max_loan_value,
      };

      // Remove undefined filters
      Object.keys(filters).forEach(
        (key) => filters[key] === undefined && delete filters[key]
      );

      const sort = {};
      sort[sort_by] = sort_order === "asc" ? 1 : -1;

      const result = await assetValuationService.getValuationsPaginated(
        filters,
        parseInt(page),
        parseInt(limit),
        sort
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Get Valuations Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to get valuations",
      });
    }
  }

  /**
   * Get all valuations without pagination
   */
  async getAllValuations(req, res) {
    try {
      const {
        asset,
        stage,
        status,
        requested_by,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      const filters = {
        asset,
        stage,
        status,
        requested_by,
      };

      // Remove undefined filters
      Object.keys(filters).forEach(
        (key) => filters[key] === undefined && delete filters[key]
      );

      const sort = {};
      sort[sort_by] = sort_order === "asc" ? 1 : -1;

      const result = await assetValuationService.getAllValuations(
        filters,
        sort
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Get All Valuations Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to get all valuations",
      });
    }
  }

  /**
   * Update valuation
   */
  async updateValuation(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user._id;

      const result = await assetValuationService.updateValuation(
        id,
        updateData,
        userId
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Update Valuation Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to update valuation",
        errors: error.errors || null,
      });
    }
  }

  /**
   * Update valuation status
   */
  async updateValuationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const userId = req.user._id;

      const result = await assetValuationService.updateValuationStatus(
        id,
        status,
        userId,
        notes
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Update Valuation Status Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to update valuation status",
      });
    }
  }

  /**
   * Delete valuation
   */
  async deleteValuation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user._id;

      const result = await assetValuationService.deleteValuation(id, userId);

      res.status(200).json(result);
    } catch (error) {
      console.error("Delete Valuation Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to delete valuation",
      });
    }
  }

  /**
   * Get valuations by asset ID
   */
  async getValuationsByAsset(req, res) {
    try {
      const { assetId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const result = await assetValuationService.getValuationsByAsset(
        assetId,
        parseInt(page),
        parseInt(limit)
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Get Valuations By Asset Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to get valuations by asset",
      });
    }
  }

  /**
   * Search valuations
   */
  async searchValuations(req, res) {
    try {
      const { q, page = 1, limit = 10 } = req.query;

      if (!q || q.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Search query is required",
        });
      }

      const result = await assetValuationService.searchValuations(
        q.trim(),
        parseInt(page),
        parseInt(limit)
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Search Valuations Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to search valuations",
      });
    }
  }

  /**
   * Get valuation statistics
   */
  async getValuationStats(req, res) {
    try {
      const result = await assetValuationService.getValuationStats();

      res.status(200).json(result);
    } catch (error) {
      console.error("Get Valuation Stats Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to get valuation statistics",
      });
    }
  }

  /**
   * Get valuations by customer
   */
  async getValuationsByCustomer(req, res) {
    try {
      const { customerId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const result = await assetValuationService.getValuationsByCustomer(
        customerId,
        parseInt(page),
        parseInt(limit)
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Get Valuations By Customer Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to get valuations by customer",
      });
    }
  }

  /**
   * Complete market valuation and proceed to final
   */
  async completeMarketValuation(req, res) {
    try {
      const { id } = req.params;
      const { estimated_market_value, comments } = req.body;
      const userId = req.user._id;

      const updateData = {
        estimated_market_value,
        comments,
        status: "completed",
      };

      const result = await assetValuationService.updateValuation(
        id,
        updateData,
        userId
      );

      // Create final stage valuation
      if (result.success) {
        const marketValuation = result.data;
        const finalValuationData = {
          asset: marketValuation.asset._id,
          stage: "final",
          status: "requested",
          requested_by: userId,
          assessment_date: new Date(),
          estimated_market_value: marketValuation.estimated_market_value,
          estimated_loan_value: marketValuation.estimated_loan_value,
          comments: "Final valuation requested after market assessment",
          meta: {
            market_valuation_id: marketValuation._id,
            market_completed_by: userId,
          },
        };

        const finalResult = await assetValuationService.createValuation(
          finalValuationData,
          userId
        );

        res.status(200).json({
          success: true,
          message: "Market valuation completed and final valuation requested",
          data: {
            market_valuation: result.data,
            final_valuation: finalResult.data,
          },
        });
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Complete Market Valuation Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to complete market valuation",
        errors: error.errors || null,
      });
    }
  }

  /**
   * Complete final valuation with loan amount decision
   */
  async completeFinalValuation(req, res) {
    try {
      const { id } = req.params;
      const { final_value, desired_loan_amount, comments, credit_check } =
        req.body;
      const userId = req.user._id;

      const updateData = {
        final_value,
        desired_loan_amount,
        comments,
        credit_check,
        status: "completed",
      };

      const result = await assetValuationService.updateValuation(
        id,
        updateData,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Final valuation completed successfully",
        data: result.data,
      });
    } catch (error) {
      console.error("Complete Final Valuation Error:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to complete final valuation",
        errors: error.errors || null,
      });
    }
  }
}

module.exports = new AssetValuationController();
