const words = [
    "apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "honeydew", "kiwi", "lemon",
    "mango", "nectarine", "orange", "papaya", "quince", "raspberry", "strawberry", "tangerine", "ugli", "watermelon",
    "ant", "bear", "cat", "dog", "elephant", "frog", "giraffe", "horse", "iguana", "jellyfish",
    "kangaroo", "lion", "monkey", "newt", "octopus", "penguin", "quail", "rabbit", "snake", "tiger",
    "unicorn", "vulture", "whale", "x-ray", "yak", "zebra",
    "airplane", "bicycle", "car", "drone", "engine", "ferry", "glider", "helicopter", "jet", "kayak",
    "limousine", "motorcycle", "nozzle", "oar", "parachute", "quad", "rocket", "submarine", "tank", "ufo",
    "van", "wagon", "yacht", "zeppelin",
    "archery", "baseball", "basketball", "cricket", "dodgeball", "football", "golf", "hockey", "ice skating", "judo",
    "karate", "lacrosse", "marathon", "netball", "olympics", "ping pong", "quidditch", "rugby", "soccer", "tennis",
    "volleyball", "wrestling", "yoga", "zumba"
];

function getRandomWords(count = 3) {
    const shuffled = words.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

module.exports = {
    getRandomWords,
    isValidWord: (word) => words.includes(word.toLowerCase())
};
