class RoomConfig {
    constructor(config) {
        config = config || {};
        this.maxPlayers = this.validateInt(config.maxPlayers, 2, 16, 8);
        this.roundTime = this.validateInt(config.roundTime, 10, 300, 60);
        this.totalRounds = this.validateInt(config.totalRounds, 1, 10, 3);
        this.hintLetterCount = this.validateInt(config.hintLetterCount, 0, 10, 2);

        // Custom word list logic
        this.customWords = [];
        if (config.customWords) {
            if (Array.isArray(config.customWords)) {
                this.customWords = config.customWords
                    .map(w => w.trim().toLowerCase())
                    .filter(w => w.length > 0);
            } else if (typeof config.customWords === 'string') {
                this.customWords = config.customWords
                    .split(/[\n,]+/)
                    .map(w => w.trim().toLowerCase())
                    .filter(w => w.length > 0);
            }
        }

        // Allowed colors (default palette if not provided or empty)
        const defaultColors = [
            '#000000', '#ff0000', '#00ff00', '#0000ff',
            '#ffff00', '#ff00ff', '#00ffff', '#ffffff',
            '#808080', '#800000', '#808000', '#008000',
            '#800080', '#008080', '#000080'
        ];

        this.allowedColors = (config.allowedColors && Array.isArray(config.allowedColors) && config.allowedColors.length > 0)
            ? config.allowedColors
            : defaultColors;
    }

    validateInt(value, min, max, defaultValue) {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < min || parsed > max) {
            return defaultValue;
        }
        return parsed;
    }

    isValidColor(color) {
        return this.allowedColors.includes(color);
    }
}

module.exports = RoomConfig;
