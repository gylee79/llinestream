"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeVideoOnWrite = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
exports.analyzeVideoOnWrite = (0, firestore_1.onDocumentWritten)({
    document: "episodes/{episodeId}",
    region: "asia-northeast3",
}, async (event) => {
    console.log("Hello Hulk! I am alive!");
    return;
});
//# sourceMappingURL=index.js.map