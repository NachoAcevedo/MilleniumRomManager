import { SteamTree, VDF_ShortcutsItem, PreviewData } from "../../../models";
import { VDF_Manager } from "../../vdf-manager";
import * as _ from "lodash";
import { generateAppId } from "./generate-app-id";

export function getNonSteamShortcutsData(
  tree: SteamTree<{ [appId: string]: VDF_ShortcutsItem }>,
) {
  return Promise.resolve().then(() => {
    let data = _.cloneDeep(tree);

    if (data.numberOfUsers === 0) return data;
    else {
      let vdfManager = new VDF_Manager();
      return Promise.resolve()
        .then(() => {
          return vdfManager.prepare(data.tree as any as PreviewData);
        })
        .then(() => {
          return vdfManager.read({
            shortcuts: { read: true, skipIndexing: true },
            addedItems: false,
            screenshots: false,
          });
        })
        .then(() => {
          vdfManager.forEach((steamDirectory, userId, listItem) => {
            if (
              data.tree[steamDirectory] !== undefined &&
              data.tree[steamDirectory][userId] !== undefined
            ) {
              data.tree[steamDirectory][userId] = Object.fromEntries(
                (listItem.shortcuts.data ?? []).filter(Boolean).map(shortcut => [
                  generateAppId(shortcut.exe, shortcut.appname), shortcut,
                ]),
              );
            }
          });
          return data;
        });
    }
  });
}
