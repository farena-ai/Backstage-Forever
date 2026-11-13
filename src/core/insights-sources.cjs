"use strict";
// Immutable public provenance, not game mechanics. Builds newest first; the first is the pack's own.
const COMMIT = "164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1";
const BUILDS = Object.freeze(["1.60.1.70888","1.60.1.70862","1.60.1.70840","1.60.1.70790"]);
const BUILD = BUILDS[0];
const SOURCES = [
  {
    "name": "quests.enUS.json",
    "build": "1.60.1.70888",
    "bytes": 5178761,
    "sha256": "433fc57290a162eca1c688c277a96234d39b7198edb1326ed4d6ec8fa4a65d60",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/quests.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 65,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "dataset": "quests",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "quest_scan.json",
    "build": "1.60.1.70888",
    "bytes": 724478,
    "sha256": "b53e42765472f9b2101e14e6f07718433d78830d02d62675fc9f4344f97a7249",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/quest_scan.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "dataset": "quest_scan",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "trainers.json",
    "build": "1.60.1.70888",
    "bytes": 347875,
    "sha256": "dc6b89950dce88e3e1674829e0f410251b9ee143d3b155c95aa6eea3fdc23a12",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/trainers.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "dataset": "trainers",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "npcs.json",
    "build": "1.60.1.70888",
    "bytes": 298166,
    "sha256": "c2b1b2e0ab58c187835428223c23f87c5a43bb36af51d20f1c6fd1c28fa60722",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/npcs.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "dataset": "npcs",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "creatures.json",
    "build": "1.60.1.70888",
    "bytes": 565733,
    "sha256": "1bf31b9f4462987773d6f76d269b179153b022442753ec8ead11092e84c2f13a",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/creatures.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "combatLogUploads": 6,
      "dataset": "creatures",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "creature_details.enUS.json",
    "build": "1.60.1.70888",
    "bytes": 1664807,
    "sha256": "415d59b7566c1fb70938784aea545919cdf3d4a432ad30dbc2b2d2995d09b9b8",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/creature_details.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 65,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "dataset": "creature_details",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "item_hotfixes.enUS.json",
    "build": "1.60.1.70888",
    "bytes": 899547,
    "sha256": "cf342708d964d0792e68b612c290eb24386119745f326cb7604cb2c4f33b0cf5",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/item_hotfixes.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 46,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70888",
      "collectedOn": {
        "first": "2026-11-10",
        "last": "2026-11-12"
      },
      "dataset": "item_hotfixes",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "quests.enUS.json",
    "build": "1.60.1.70862",
    "bytes": 4204753,
    "sha256": "7b96a1e976a6746492f8a17e8de9ab1b014f236ebfb01e5f03dbe81880777877",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/quests.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 142,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-10"
      },
      "dataset": "quests",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "quest_scan.json",
    "build": "1.60.1.70862",
    "bytes": 654933,
    "sha256": "c237d72377bad9904bf4ad49d1121cc73ae3f2aa94847cfcc8d75e28268fbae3",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/quest_scan.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-10"
      },
      "dataset": "quest_scan",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "trainers.json",
    "build": "1.60.1.70862",
    "bytes": 855550,
    "sha256": "1efa38813578ef20f733af4567a6dd3c7e1428245eb9932d360a60ea5200734a",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/trainers.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "trainers",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "npcs.json",
    "build": "1.60.1.70862",
    "bytes": 732509,
    "sha256": "fcde4f6d58a51f83a2d6b0dfa9fdb01b717378585b53200c4f6082878d59acbf",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/npcs.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "npcs",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "creatures.json",
    "build": "1.60.1.70862",
    "bytes": 1154158,
    "sha256": "e4519dad93fb2394335502f93ae8e33f0282c2e6fae6d1a6fc5fb63b462dbfe7",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/creatures.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-12"
      },
      "combatLogUploads": 11,
      "dataset": "creatures",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "creature_details.enUS.json",
    "build": "1.60.1.70862",
    "bytes": 1906616,
    "sha256": "a610bf0a92892394364ae2b7d8205bbe66281b00d35ca95438756db13354c83d",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/creature_details.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 142,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-10"
      },
      "dataset": "creature_details",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "item_hotfixes.enUS.json",
    "build": "1.60.1.70862",
    "bytes": 706706,
    "sha256": "71bab433efbfd3bd04f579ef0a701c11a2a3ce0bc8daae8d3d5d8efcf5192ce2",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/item_hotfixes.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 135,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70862",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-10"
      },
      "dataset": "item_hotfixes",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 5
    }
  },
  {
    "name": "quests.enUS.json",
    "build": "1.60.1.70840",
    "bytes": 2686938,
    "sha256": "e78aaae3aee37b26a47de4eef4b171910a04e77b9cb85bc3985a25bd0c058294",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/quests.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 4,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-07"
      },
      "dataset": "quests",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 2
    }
  },
  {
    "name": "quest_scan.json",
    "build": "1.60.1.70840",
    "bytes": 348745,
    "sha256": "a33a0c1eb0eee42c747b6355ba38fad4892456ab44a7671b7fa944af8bd6b319",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/quest_scan.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-07"
      },
      "dataset": "quest_scan",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 2
    }
  },
  {
    "name": "trainers.json",
    "build": "1.60.1.70840",
    "bytes": 169606,
    "sha256": "61530bb1523c64d1f1e7c50e7991b5339e6a71745d3846022a9af8947fc027e3",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/trainers.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "trainers",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  },
  {
    "name": "npcs.json",
    "build": "1.60.1.70840",
    "bytes": 123058,
    "sha256": "4ddc55031c196727591870ce56701f0fa34ec5173624174109d747ff31bd7c4d",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/npcs.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "npcs",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  },
  {
    "name": "creatures.json",
    "build": "1.60.1.70840",
    "bytes": 195916,
    "sha256": "bfda9311a3698d144cae5feb97b3021a20dfe203f19293039f9a09b63a613b1c",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/creatures.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "creatures",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  },
  {
    "name": "creature_details.enUS.json",
    "build": "1.60.1.70840",
    "bytes": 688886,
    "sha256": "76371579fa90a2cc67a334c9367bdc243a97fdb852f5feef396f16a9a948c40f",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/creature_details.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 4,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-07"
      },
      "dataset": "creature_details",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 2
    }
  },
  {
    "name": "item_hotfixes.enUS.json",
    "build": "1.60.1.70840",
    "bytes": 510641,
    "sha256": "a09bbcc400ad2aecca0d938612775e70c0a0462f09f4ef5089e988146ddf28d6",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70840/item_hotfixes.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 2,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70840",
      "collectedOn": {
        "first": "2026-11-07",
        "last": "2026-11-07"
      },
      "dataset": "item_hotfixes",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 2
    }
  },
  {
    "name": "quests.enUS.json",
    "build": "1.60.1.70790",
    "bytes": 1278106,
    "sha256": "1d338604744f0100ec58ea14c904f1b1c676b826d832bc747c90eae27b569bc7",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/quests.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 147,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-04",
        "last": "2026-11-06"
      },
      "dataset": "quests",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  },
  {
    "name": "quest_scan.json",
    "build": "1.60.1.70790",
    "bytes": 163811,
    "sha256": "61dcbb4de5f9b08fe65c091080bb3af8eeff0c4a4ced8f31b27ef0e449f17e56",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/quest_scan.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-06",
        "last": "2026-11-07"
      },
      "dataset": "quest_scan",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  },
  {
    "name": "trainers.json",
    "build": "1.60.1.70790",
    "bytes": 1113381,
    "sha256": "ea0d7b6e13543bf0ab827975d934fe3f36373a6476f0648493f75c19352ab7e8",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/trainers.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "trainers",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "npcs.json",
    "build": "1.60.1.70790",
    "bytes": 882823,
    "sha256": "e87240d379baa5de0eb030d76676f4d07ddf3b863d0833d33a43b4a3ec8b0775",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/npcs.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-09",
        "last": "2026-11-12"
      },
      "dataset": "npcs",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "creatures.json",
    "build": "1.60.1.70790",
    "bytes": 1122140,
    "sha256": "f4c92a425c4e6c5a2aa559471c29c8b43f7920509740b0fbcd9ea0e00dd46fb7",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/creatures.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-05",
        "last": "2026-11-12"
      },
      "combatLogUploads": 13,
      "dataset": "creatures",
      "license": "CC BY 4.0",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 4
    }
  },
  {
    "name": "creature_details.enUS.json",
    "build": "1.60.1.70790",
    "bytes": 1161673,
    "sha256": "b4a08094d881edb18f168bee8b71acc2e9d41165d590a1eefcb011a94a9e6762",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/creature_details.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 147,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-04",
        "last": "2026-11-06"
      },
      "dataset": "creature_details",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  },
  {
    "name": "item_hotfixes.enUS.json",
    "build": "1.60.1.70790",
    "bytes": 584596,
    "sha256": "7f26b09eaa33062e3102f89ff64be0a555a82612e94db50c396250ae2ab8abee",
    "url": "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70790/item_hotfixes.enUS.json",
    "meta": {
      "attribution": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
      "cacheFiles": 128,
      "cachesLeftOut": 0,
      "clientBuild": "1.60.1.70790",
      "collectedOn": {
        "first": "2026-11-04",
        "last": "2026-11-06"
      },
      "dataset": "item_hotfixes",
      "license": "CC BY 4.0",
      "locale": "enUS",
      "product": "wowf",
      "schemaVersion": 1,
      "sources": 3
    }
  }
];
module.exports = { COMMIT, BUILD, BUILDS, SOURCES };
