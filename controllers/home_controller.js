const homeService = require("../services/home_service");

class HomeController {
  /**
   * GET /home – Returns home data for the authenticated user based on their role.
   */
  async getHomeData(req, res) {
    try {
      const result = await homeService.getHomeData(req.user);
      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new HomeController();
