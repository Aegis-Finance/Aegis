// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./../interfaces/ICommonErrors.sol";

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AegisCrowdShield} from "./AegisCrowdShield.sol";
import {ICreatorReputationTracker} from "../interfaces/ICreatorReputationTracker.sol";

/**
 * @title ProjectDisplayRegistry
 * @author Aegis Protocol Team
 * @notice Decentralized project discovery and display system implementing Austrian Economics principles
 * @dev Decentralized project discovery and display system implementing Austrian Economics principles:
 *      - Spontaneous Order: Market-driven project categorization and discovery
 *      - Individual Sovereignty: Creator control over project presentation
 *      - Voluntary Association: Opt-in discovery and promotion mechanisms
 *      - Market-Driven Pricing: Dynamic promotion costs based on demand
 *      - Methodological Individualism: Individual project evaluation and ranking
 */
contract ProjectDisplayRegistry is ReentrancyGuard , ICommonErrors{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct ProjectDisplay {
        uint256 campaignId;                 // Associated campaign ID (32 bytes)
        uint256 createdAt;                  // Creation timestamp (32 bytes)
        uint256 lastUpdated;                // Last update timestamp (32 bytes)
        address creator;                    // Project creator (20 bytes)
        bool isActive;                      // Whether project is active (1 byte)
        bool isPromoted;                    // Whether project is promoted (1 byte)
        // 10 bytes remaining in this slot
        string title;                       // Project title
        string description;                 // Project description
        string imageHash;                   // IPFS hash for project image
        string[] tags;                      // Project tags for categorization
        string websiteUrl;                  // Project website
        string socialLinks;                 // JSON string of social media links
        ProjectMetadata metadata;           // Additional project metadata
        DisplayConfig displayConfig;       // Display configuration
        MarketMetrics marketMetrics;        // Market-driven metrics
    }

    struct ProjectMetadata {
        string category;                    // Project category
        string subcategory;                 // Project subcategory
        uint256 expectedDuration;          // Expected project duration
        string riskLevel;                   // Risk assessment
        string[] milestoneDescriptions;     // Milestone descriptions
        string teamInfo;                    // Team information
        string technicalSpecs;              // Technical specifications
        string legalCompliance;             // Legal compliance information
    }

    struct DisplayConfig {
        bool enablePublicDisplay;           // Public visibility
        bool enableSearchIndexing;         // Search engine indexing
        bool enableCommunityRating;        // Community rating system
        bool enableMarketAnalytics;         // Market analytics tracking
        uint256 promotionLevel;             // Promotion level (0-5)
        uint256 featuredUntil;              // Featured until timestamp
        string[] preferredCategories;       // Preferred display categories
    }

    struct MarketMetrics {
        uint256 viewCount;                  // Total views
        uint256 uniqueViewers;              // Unique viewer count
        uint256 interactionCount;           // Total interactions
        uint256 shareCount;                 // Share count
        uint256 bookmarkCount;              // Bookmark count
        uint256 averageRating;              // Average community rating (1-5 stars)
        uint256 ratingCount;                // Number of ratings
        uint256 marketScore;                // Calculated market score
        uint256 trendingScore;              // Trending algorithm score
        uint256 lastMetricUpdate;           // Last metrics update
    }

    struct CategoryInfo {
        string name;                        // Category name
        string description;                 // Category description
        uint256 projectCount;               // Number of projects in category
        uint256 totalFunding;               // Total funding in category
        uint256 averageSuccess;             // Average success rate
        bool isActive;                      // Whether category is active
        address[] moderators;               // Category moderators
    }

    struct PromotionPackage {
        uint256 packageId;                  // Package ID
        string name;                        // Package name
        uint256 cost;                       // Cost in wei or tokens
        uint256 duration;                   // Duration in seconds
        uint256 boostMultiplier;            // Visibility boost multiplier
        bool enableFeatured;                // Featured placement
        bool enableTrending;                // Trending boost
        bool enableCategoryTop;             // Category top placement
        bool isActive;                      // Whether package is active
    }

    struct UserInteraction {
        address user;                       // User address
        uint256 campaignId;                 // Campaign interacted with
        InteractionType interactionType;    // Type of interaction
        uint256 timestamp;                  // Interaction timestamp
        bytes32 dataHash;                   // Hash of interaction data
    }

    /// @notice Configuration for promotion pricing and moderation
    struct PromotionConfig {
        uint256 basePromotionCost;      // Base cost for promotion
        uint256 promotionCostMultiplier; // Multiplier per level (basis points)
        uint256 categoryModerationStake; // Stake required for category moderation
    }
    
    /// @notice Weights for the discovery algorithm
    struct DiscoveryWeights {
        uint256 viewWeight;        // Weight for view count
        uint256 interactionWeight; // Weight for interactions
        uint256 ratingWeight;      // Weight for ratings
        uint256 fundingWeight;     // Weight for funding amount
        uint256 recencyWeight;     // Weight for recency
    }

    enum InteractionType {
        View,           // Project view
        Like,           // Project like
        Share,          // Project share
        Bookmark,       // Project bookmark
        Rate,           // Project rating
        Comment,        // Project comment
        Follow,         // Creator follow
        Report          // Report project
    }

    // Custom Errors
    error NotProjectCreator();
    error ProjectDoesNotExist();
    
    error ProjectAlreadyRegistered();
    error InvalidTitleLength();
    
    error TooManyTags();
    error InvalidPromotionLevel();
    error InvalidCategory();
    error InvalidPromotionPackage();
    error InsufficientPayment();
    error RefundFailed();
    error InteractionAlreadyRecorded();
    error RatingDisabled();
    error InvalidCategoryName();
    error CategoryAlreadyExists();
    error InsufficientStake();

    // State Variables
    /// @notice The AegisCrowdShield contract instance for campaign validation
    AegisCrowdShield public immutable CROWD_SHIELD;
    
    /// @notice Mapping of campaign IDs to their project display information
    mapping(uint256 => ProjectDisplay) public projectDisplays;
    /// @notice Mapping of category names to their information and metadata
    mapping(string => CategoryInfo) public categories;
    /// @notice Mapping of promotion package IDs to their configuration details
    mapping(uint256 => PromotionPackage) public promotionPackages;
    /// @notice Mapping of creator addresses to arrays of their project campaign IDs
    mapping(address => uint256[]) public creatorProjects;
    /// @notice Mapping of category names to arrays of project campaign IDs in that category
    mapping(string => uint256[]) public categoryProjects;
    /// @notice Mapping to track used interaction hashes to prevent replay attacks
    mapping(bytes32 => bool) public usedInteractionHashes;
    /// @notice Mapping to track user interactions with specific projects
    mapping(address => mapping(uint256 => bool)) public userProjectInteractions;
    /// @notice Mapping to store user ratings for specific projects
    mapping(address => mapping(uint256 => uint256)) public userRatings;
    
    // Market-driven discovery arrays
    /// @notice Array of campaign IDs for featured projects
    uint256[] public featuredProjects;
    /// @notice Array of campaign IDs for trending projects
    uint256[] public trendingProjects;
    /// @notice Array of campaign IDs for recently created projects
    uint256[] public recentProjects;
    /// @notice Array of campaign IDs for top-rated projects
    uint256[] public topRatedProjects;
    
    // Austrian Economics Parameters
    /// @notice Maximum number of tags allowed per project
    uint256 public constant MAX_TAGS = 10;
    /// @notice Maximum length allowed for project descriptions
    uint256 public constant MAX_DESCRIPTION_LENGTH = 2000;
    /// @notice Maximum promotion level available for projects
    uint256 public constant MAX_PROMOTION_LEVEL = 5;
    /// @notice Time window for calculating trending metrics
    uint256 public constant TRENDING_WINDOW = 7 days;
    /// @notice Duration for which projects remain featured
    uint256 public constant FEATURED_DURATION = 30 days;
    /// @notice Maximum rating scale (1-5 stars)
    uint256 public constant RATING_SCALE = 5;
    
    // Market-driven configuration
    /// @notice Configuration parameters for promotion pricing and mechanics
    PromotionConfig public promotionConfig;
    /// @notice Weights used in discovery algorithm calculations
    DiscoveryWeights public discoveryWeights;

    // Events
    /// @notice Emitted when a new project is registered in the display registry
    /// @param campaignId The unique identifier of the campaign
    /// @param creator The address of the project creator
    /// @param title The title of the project
    /// @param category The category the project belongs to
    event ProjectRegistered(
        uint256 indexed campaignId,
        address indexed creator,
        string title,
        string category
    );
    
    /// @notice Emitted when a project's information is updated
    /// @param campaignId The unique identifier of the campaign
    /// @param updater The address that performed the update
    /// @param timestamp The timestamp when the update occurred
    event ProjectUpdated(
        uint256 indexed campaignId,
        address indexed updater,
        uint256 timestamp
    );
    
    /// @notice Emitted when a project is promoted for enhanced visibility
    /// @param campaignId The unique identifier of the campaign
    /// @param promotionLevel The level of promotion applied
    /// @param duration The duration of the promotion in seconds
    /// @param cost The cost paid for the promotion
    event ProjectPromoted(
        uint256 indexed campaignId,
        uint256 promotionLevel,
        uint256 duration,
        uint256 cost
    );
    
    /// @notice Emitted when a new category is created
    /// @param categoryName The name of the new category
    /// @param creator The address that created the category
    /// @param description The description of the category
    event CategoryCreated(
        string indexed categoryName,
        address indexed creator,
        string description
    );
    
    /// @notice Emitted when a user interaction with a project is recorded
    /// @param user The address of the user who interacted
    /// @param campaignId The unique identifier of the campaign
    /// @param interactionType The type of interaction performed
    /// @param timestamp The timestamp when the interaction occurred
    event UserInteractionRecorded(
        address indexed user,
        uint256 indexed campaignId,
        InteractionType interactionType,
        uint256 timestamp
    );
    
    /// @notice Emitted when a project receives a rating from a user
    /// @param campaignId The unique identifier of the campaign
    /// @param rater The address of the user who provided the rating
    /// @param rating The rating value given (1-5 scale)
    /// @param newAverageRating The new average rating after this rating
    event ProjectRated(
        uint256 indexed campaignId,
        address indexed rater,
        uint256 rating,
        uint256 newAverageRating
    );
    
    /// @notice Emitted when market metrics for a project are updated
    /// @param campaignId The unique identifier of the campaign
    /// @param marketScore The calculated market score
    /// @param trendingScore The calculated trending score
    event MarketMetricsUpdated(
        uint256 indexed campaignId,
        uint256 marketScore,
        uint256 trendingScore
    );
    
    /// @notice Emitted when a new promotion package is created
    /// @param packageId The unique identifier of the promotion package
    /// @param name The name of the promotion package
    /// @param cost The cost of the promotion package
    /// @param duration The duration of the promotion package
    event PromotionPackageCreated(
        uint256 indexed packageId,
        string name,
        uint256 cost,
        uint256 duration
    );

    // Modifiers
    modifier onlyProjectCreator(uint256 campaignId) {
        if (projectDisplays[campaignId].creator != msg.sender) revert NotProjectCreator();
        _;
    }
    
    modifier projectExists(uint256 campaignId) {
        if (!projectDisplays[campaignId].isActive) revert ProjectDoesNotExist();
        _;
    }
    
    modifier validRating(uint256 rating) {
        if (rating < 1 || rating > RATING_SCALE) revert ICommonErrors.InvalidRating();
        _;
    }

    /// @notice Initializes the ProjectDisplayRegistry with the CrowdShield contract
    /// @param _crowdShield Address of the AegisCrowdShield contract for campaign validation
    constructor(address _crowdShield) {
        if (_crowdShield == address(0)) revert InvalidCrowdShieldAddress();
        CROWD_SHIELD = AegisCrowdShield(_crowdShield);
        
        // Initialize promotion configuration
        promotionConfig = PromotionConfig({
            basePromotionCost: 0.01 ether,
            promotionCostMultiplier: 150, // 1.5x per level
            categoryModerationStake: 0.1 ether
        });
        
        // Initialize discovery weights
        discoveryWeights = DiscoveryWeights({
            viewWeight: 1,
            interactionWeight: 3,
            ratingWeight: 5,
            fundingWeight: 2,
            recencyWeight: 1
        });
        
        // Initialize default categories
        _createDefaultCategories();
        
        // Initialize default promotion packages
        _createDefaultPromotionPackages();
    }

    /**
     * @notice Register a project for display and discovery in the registry
     * @param campaignId Campaign ID to register
     * @param title Project title
     * @param description Project description
     * @param imageHash IPFS hash for project image
     * @param tags Project tags
     * @param metadata Additional project metadata
     * @param displayConfig Display configuration
     */
    function registerProject(
        uint256 campaignId,
        string calldata title,
        string calldata description,
        string calldata imageHash,
        string[] calldata tags,
        ProjectMetadata calldata metadata,
        DisplayConfig calldata displayConfig
    ) external nonReentrant {
        // Verify campaign exists and caller is creator
        AegisCrowdShield.CampaignSovereignty memory campaign = CROWD_SHIELD.getCampaign(campaignId);
        if (campaign.creator != msg.sender) revert NotProjectCreator();
        if (projectDisplays[campaignId].isActive) revert ProjectAlreadyRegistered();
        
        // Validate input parameters
        if (bytes(title).length == 0 || bytes(title).length > 100) revert InvalidTitleLength();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        if (tags.length > MAX_TAGS) revert TooManyTags();
        if (displayConfig.promotionLevel > MAX_PROMOTION_LEVEL) revert InvalidPromotionLevel();
        
        // Validate category exists
        if (!categories[metadata.category].isActive) revert InvalidCategory();

        projectDisplays[campaignId] = ProjectDisplay({
            campaignId: campaignId,
            creator: msg.sender,
            title: title,
            description: description,
            imageHash: imageHash,
            tags: tags,
            websiteUrl: "",
            socialLinks: "",
            metadata: metadata,
            displayConfig: displayConfig,
            marketMetrics: MarketMetrics({
                viewCount: 0,
                uniqueViewers: 0,
                interactionCount: 0,
                shareCount: 0,
                bookmarkCount: 0,
                averageRating: 0,
                ratingCount: 0,
                marketScore: 0,
                trendingScore: 0,
                lastMetricUpdate: block.timestamp
            }),
            createdAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true,
            isPromoted: false
        });

        // Update registry mappings
        creatorProjects[msg.sender].push(campaignId);
        categoryProjects[metadata.category].push(campaignId);
        ++categories[metadata.category].projectCount;
        recentProjects.push(campaignId);

        emit ProjectRegistered(campaignId, msg.sender, title, metadata.category);
    }

    /**
     * @notice Update project display information
     * @param campaignId Campaign to update
     * @param title New title
     * @param description New description
     * @param imageHash New image hash
     * @param tags New tags
     * @param websiteUrl Website URL
     * @param socialLinks Social media links
     */
    function updateProject(
        uint256 campaignId,
        string calldata title,
        string calldata description,
        string calldata imageHash,
        string[] calldata tags,
        string calldata websiteUrl,
        string calldata socialLinks
    ) external nonReentrant onlyProjectCreator(campaignId) projectExists(campaignId) {
        if (bytes(title).length == 0 || bytes(title).length > 100) revert InvalidTitleLength();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        if (tags.length > MAX_TAGS) revert TooManyTags();

        ProjectDisplay storage project = projectDisplays[campaignId];
        project.title = title;
        project.description = description;
        project.imageHash = imageHash;
        project.tags = tags;
        project.websiteUrl = websiteUrl;
        project.socialLinks = socialLinks;
        project.lastUpdated = block.timestamp;

        emit ProjectUpdated(campaignId, msg.sender, block.timestamp);
    }

    /**
     * @notice Promote a project for increased visibility
     * @param campaignId Campaign to promote
     * @param packageId Promotion package to use
     */
    function promoteProject(
        uint256 campaignId,
        uint256 packageId
    ) external payable nonReentrant onlyProjectCreator(campaignId) projectExists(campaignId) {
        PromotionPackage memory package = promotionPackages[packageId];
        if (!package.isActive) revert InvalidPromotionPackage();
        if (msg.value < package.cost) revert InsufficientPayment();

        ProjectDisplay storage project = projectDisplays[campaignId];
        
        // Apply promotion benefits
        project.isPromoted = true;
        project.displayConfig.promotionLevel = packageId;
        
        if (package.enableFeatured) {
            project.displayConfig.featuredUntil = block.timestamp + package.duration;
            featuredProjects.push(campaignId);
        }
        
        if (package.enableTrending) {
            project.marketMetrics.trendingScore += package.boostMultiplier * 100;
            _updateTrendingProjects(campaignId);
        }

        // Update market metrics
        project.marketMetrics.marketScore += package.boostMultiplier * 50;
        project.marketMetrics.lastMetricUpdate = block.timestamp;

        // Refund excess payment
        if (msg.value > package.cost) {
            (bool success, ) = payable(msg.sender).call{value: msg.value - package.cost}("");
            if (!success) revert RefundFailed();
        }

        emit ProjectPromoted(campaignId, packageId, package.duration, package.cost);
    }

    /**
     * @notice Record user interaction with a project
     * @param campaignId Campaign interacted with
     * @param interactionType Type of interaction
     * @param dataHash Hash of interaction data
     */
    function recordInteraction(
        uint256 campaignId,
        InteractionType interactionType,
        bytes32 dataHash
    ) external nonReentrant projectExists(campaignId) {
        if (usedInteractionHashes[dataHash]) revert InteractionAlreadyRecorded();
        
        ProjectDisplay storage project = projectDisplays[campaignId];
        
        // Update interaction metrics
        ++project.marketMetrics.interactionCount;
        
        if (interactionType == InteractionType.View) {
            ++project.marketMetrics.viewCount;
            if (!userProjectInteractions[msg.sender][campaignId]) {
                ++project.marketMetrics.uniqueViewers;
                userProjectInteractions[msg.sender][campaignId] = true;
            }
        } else if (interactionType == InteractionType.Share) {
            ++project.marketMetrics.shareCount;
        } else if (interactionType == InteractionType.Bookmark) {
            ++project.marketMetrics.bookmarkCount;
        }

        usedInteractionHashes[dataHash] = true;
        
        // Update market scores
        _updateMarketMetrics(campaignId);

        emit UserInteractionRecorded(msg.sender, campaignId, interactionType, block.timestamp);
    }

    /**
     * @notice Rate a project (Austrian Economics: Individual evaluation)
     * @param campaignId Campaign to rate
     * @param rating Rating (1-5 stars)
     */
    function rateProject(
        uint256 campaignId,
        uint256 rating
    ) external nonReentrant projectExists(campaignId) validRating(rating) {
        ProjectDisplay storage project = projectDisplays[campaignId];
        if (!project.displayConfig.enableCommunityRating) revert RatingDisabled();
        
        uint256 previousRating = userRatings[msg.sender][campaignId];
        userRatings[msg.sender][campaignId] = rating;

        // Update average rating
        if (previousRating == 0) {
            // New rating
            uint256 totalRating = project.marketMetrics.averageRating * project.marketMetrics.ratingCount;
            ++project.marketMetrics.ratingCount;
            project.marketMetrics.averageRating = (totalRating + rating) / project.marketMetrics.ratingCount;
        } else {
            // Update existing rating
            uint256 totalRating = project.marketMetrics.averageRating * project.marketMetrics.ratingCount;
            totalRating = totalRating - previousRating + rating;
            project.marketMetrics.averageRating = totalRating / project.marketMetrics.ratingCount;
        }

        // Update market metrics
        _updateMarketMetrics(campaignId);

        emit ProjectRated(campaignId, msg.sender, rating, project.marketMetrics.averageRating);
    }

    /**
     * @dev Create a new project category
     * @param name Category name
     * @param description Category description
     */
    function createCategory(
        string calldata name,
        string calldata description
    ) external payable nonReentrant {
        if (bytes(name).length == 0 || bytes(name).length > 50) revert InvalidCategoryName();
        if (categories[name].isActive) revert CategoryAlreadyExists();
        if (msg.value < promotionConfig.categoryModerationStake) revert InsufficientStake();

        categories[name] = CategoryInfo({
            name: name,
            description: description,
            projectCount: 0,
            totalFunding: 0,
            averageSuccess: 0,
            isActive: true,
            moderators: new address[](1)
        });
        
        categories[name].moderators[0] = msg.sender;

        emit CategoryCreated(name, msg.sender, description);
    }

    /**
     * @dev Update market metrics for a project
     * @param campaignId Campaign to update metrics for
     */
    function _updateMarketMetrics(uint256 campaignId) internal {
        ProjectDisplay storage project = projectDisplays[campaignId];
        
        // Calculate market score based on various factors
        uint256 marketScore = 0;
        marketScore += project.marketMetrics.viewCount * discoveryWeights.viewWeight;
        marketScore += project.marketMetrics.interactionCount * discoveryWeights.interactionWeight;
        marketScore += project.marketMetrics.averageRating * 
            project.marketMetrics.ratingCount * 
            discoveryWeights.ratingWeight;
        
        // Add funding weight
        AegisCrowdShield.CampaignSovereignty memory campaign = CROWD_SHIELD.getCampaign(campaignId);
        marketScore += (campaign.totalRaised / 1 ether) * discoveryWeights.fundingWeight;
        
        // Add recency weight (guard corrupt/future createdAt)
        uint256 createdAt = project.createdAt;
        uint256 daysSinceCreation = createdAt > block.timestamp ? 0 : (block.timestamp - createdAt) / 1 days;
        if (daysSinceCreation < 30) {
            marketScore += (30 - daysSinceCreation) * discoveryWeights.recencyWeight;
        }

        project.marketMetrics.marketScore = marketScore;
        
        // Calculate trending score (recent activity weighted)
        uint256 recentActivity = 0;
        uint256 lastMetricUp = project.marketMetrics.lastMetricUpdate;
        if (
            lastMetricUp != 0 &&
            lastMetricUp <= block.timestamp &&
            block.timestamp - lastMetricUp < TRENDING_WINDOW
        ) {
            recentActivity = project.marketMetrics.interactionCount;
        }
        project.marketMetrics.trendingScore = recentActivity * 10;
        
        project.marketMetrics.lastMetricUpdate = block.timestamp;

        // Update discovery arrays
        _updateTrendingProjects(campaignId);
        _updateTopRatedProjects(campaignId);

        emit MarketMetricsUpdated(campaignId, marketScore, project.marketMetrics.trendingScore);
    }

    /**
     * @dev Update trending projects array
     * @param campaignId Campaign to potentially add to trending
     */
    function _updateTrendingProjects(uint256 campaignId) internal {
        // Simple implementation - in production would use more sophisticated algorithm
        if (projectDisplays[campaignId].marketMetrics.trendingScore > 100) {
            // Check if already in trending
            bool alreadyTrending = false;
            for (uint256 i = 0; i < trendingProjects.length; ++i) {
                if (trendingProjects[i] == campaignId) {
                    alreadyTrending = true;
                    break;
                }
            }
            
            if (!alreadyTrending) {
                trendingProjects.push(campaignId);
            }
        }
    }

    /**
     * @dev Update top rated projects array
     * @param campaignId Campaign to potentially add to top rated
     */
    function _updateTopRatedProjects(uint256 campaignId) internal {
        ProjectDisplay storage project = projectDisplays[campaignId];
        
        if (project.marketMetrics.averageRating >= 4 && project.marketMetrics.ratingCount >= 5) {
            // Check if already in top rated
            bool alreadyTopRated = false;
            for (uint256 i = 0; i < topRatedProjects.length; ++i) {
                if (topRatedProjects[i] == campaignId) {
                    alreadyTopRated = true;
                    break;
                }
            }
            
            if (!alreadyTopRated) {
                topRatedProjects.push(campaignId);
            }
        }
    }

    /**
     * @dev Create default categories
     */
    function _createDefaultCategories() internal {
        string[8] memory defaultCategories = [
            "Technology",
            "Creative",
            "Community",
            "Business",
            "Education",
            "Health",
            "Environment",
            "Gaming"
        ];
        
        for (uint256 i = 0; i < defaultCategories.length; ++i) {
            categories[defaultCategories[i]] = CategoryInfo({
                name: defaultCategories[i],
                description: string(abi.encodePacked("Default ", defaultCategories[i], " category")),
                projectCount: 0,
                totalFunding: 0,
                averageSuccess: 0,
                isActive: true,
                moderators: new address[](0)
            });
        }
    }

    /**
     * @dev Create default promotion packages
     */
    function _createDefaultPromotionPackages() internal {
        // Basic promotion package
        promotionPackages[1] = PromotionPackage({
            packageId: 1,
            name: "Basic Boost",
            cost: 0.01 ether,
            duration: 7 days,
            boostMultiplier: 2,
            enableFeatured: false,
            enableTrending: true,
            enableCategoryTop: false,
            isActive: true
        });
        
        // Premium promotion package
        promotionPackages[2] = PromotionPackage({
            packageId: 2,
            name: "Premium Feature",
            cost: 0.05 ether,
            duration: 14 days,
            boostMultiplier: 5,
            enableFeatured: true,
            enableTrending: true,
            enableCategoryTop: true,
            isActive: true
        });
        
        // Enterprise promotion package
        promotionPackages[3] = PromotionPackage({
            packageId: 3,
            name: "Enterprise Spotlight",
            cost: 0.1 ether,
            duration: 30 days,
            boostMultiplier: 10,
            enableFeatured: true,
            enableTrending: true,
            enableCategoryTop: true,
            isActive: true
        });
    }

    // View Functions
    /**
     * @notice Get project display information
     * @param campaignId Campaign ID to retrieve
     * @return ProjectDisplay struct containing all project display data
     */
    function getProjectDisplay(uint256 campaignId) 
        external 
        view 
        returns (ProjectDisplay memory) 
    {
        return projectDisplays[campaignId];
    }
    
    /**
     * @notice Get all projects created by a specific creator
     * @param creator Address of the project creator
     * @return Array of campaign IDs created by the creator
     */
    function getCreatorProjects(address creator) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return creatorProjects[creator];
    }
    
    /**
     * @notice Get all projects in a specific category
     * @param category Category name to filter by
     * @return Array of campaign IDs in the category
     */
    function getCategoryProjects(string calldata category) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return categoryProjects[category];
    }
    
    /**
     * @notice Get all featured projects
     * @return Array of featured campaign IDs
     */
    function getFeaturedProjects() 
        external 
        view 
        returns (uint256[] memory) 
    {
        return featuredProjects;
    }
    
    /**
     * @notice Get all trending projects
     * @return Array of trending campaign IDs
     */
    function getTrendingProjects() 
        external 
        view 
        returns (uint256[] memory) 
    {
        return trendingProjects;
    }
    
    /**
     * @notice Get all top-rated projects
     * @return Array of top-rated campaign IDs
     */
    function getTopRatedProjects() 
        external 
        view 
        returns (uint256[] memory) 
    {
        return topRatedProjects;
    }
    
    /**
     * @notice Get all recently created projects
     * @return Array of recent campaign IDs
     */
    function getRecentProjects() 
        external 
        view 
        returns (uint256[] memory) 
    {
        return recentProjects;
    }
    
    /**
     * @notice Get information about a specific category
     * @param category Category name to retrieve info for
     * @return CategoryInfo struct containing category details
     */
    function getCategoryInfo(string calldata category) 
        external 
        view 
        returns (CategoryInfo memory) 
    {
        return categories[category];
    }
    
    /**
     * @notice Get promotion package details
     * @param packageId Package ID to retrieve
     * @return PromotionPackage struct containing package details
     */
    function getPromotionPackage(uint256 packageId) 
        external 
        view 
        returns (PromotionPackage memory) 
    {
        return promotionPackages[packageId];
    }
    
    /**
     * @notice Get user's rating for a specific project
     * @param user User address
     * @param campaignId Campaign ID
     * @return User's rating (1-5 stars, 0 if not rated)
     */
    function getUserRating(address user, uint256 campaignId) 
        external 
        view 
        returns (uint256) 
    {
        return userRatings[user][campaignId];
    }

    // Admin Functions (Austrian Economics: Minimal intervention)
    /**
     * @notice Update discovery algorithm weights
     * @param _viewWeight Weight for view count in discovery algorithm
     * @param _interactionWeight Weight for interaction count in discovery algorithm
     * @param _ratingWeight Weight for rating in discovery algorithm
     * @param _fundingWeight Weight for funding amount in discovery algorithm
     * @param _recencyWeight Weight for recency in discovery algorithm
     */
    function updateDiscoveryWeights(
        uint256 _viewWeight,
        uint256 _interactionWeight,
        uint256 _ratingWeight,
        uint256 _fundingWeight,
        uint256 _recencyWeight
    ) external {
        // Note: In a truly decentralized system, this would be governed by the community
        discoveryWeights.viewWeight = _viewWeight;
        discoveryWeights.interactionWeight = _interactionWeight;
        discoveryWeights.ratingWeight = _ratingWeight;
        discoveryWeights.fundingWeight = _fundingWeight;
        discoveryWeights.recencyWeight = _recencyWeight;
    }
    
    /**
     * @notice Update promotion cost configuration
     * @param _basePromotionCost Base cost for promotion
     * @param _promotionCostMultiplier Multiplier for promotion costs
     * @param _categoryModerationStake Stake required for category moderation
     */
    function updatePromotionCosts(
        uint256 _basePromotionCost,
        uint256 _promotionCostMultiplier,
        uint256 _categoryModerationStake
    ) external {
        // Note: In a truly decentralized system, this would be governed by the community
        promotionConfig.basePromotionCost = _basePromotionCost;
        promotionConfig.promotionCostMultiplier = _promotionCostMultiplier;
        promotionConfig.categoryModerationStake = _categoryModerationStake;
    }

    // Receive ETH
    receive() external payable {
        // Allow contract to receive ETH for promotion payments
    }
}