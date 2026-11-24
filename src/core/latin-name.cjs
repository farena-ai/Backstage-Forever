"use strict";
// Upstream observation files (npcs, vendors, trainers, creatures, flights) carry names in the
// language of the contributor's game. The bundled reference is English, so a name written in
// another script (Korean, Chinese, Cyrillic ...) is not used: the compilers take the English
// name from another build or leave the row out. Names in Latin letters cannot be told apart.
const OTHER_SCRIPT = /[Ͱ-᷿⺀-퟿豈-﫿＀-￯]/;
const latinName = (s) => typeof s === "string" && !OTHER_SCRIPT.test(s);
module.exports = { latinName };
