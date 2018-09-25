/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/

import { expect, assert } from "chai";
import { FeatureOverrides, Target } from "@bentley/imodeljs-frontend/lib/webgl";
import { IModelApp, ScreenViewport, IModelConnection, SpatialViewState, StandardViewId } from "@bentley/imodeljs-frontend";
import { PackedFeatureTable } from "@bentley/imodeljs-frontend/lib/rendering";
import { CONSTANTS } from "../common/Testbed";
import * as path from "path";
import { GeometryClass, FeatureTable, Feature } from "@bentley/imodeljs-common/lib/Render";
import { Id64 } from "@bentley/bentleyjs-core";
import { WebGLTestContext } from "./WebGLTestContext";

const iModelLocation = path.join(CONSTANTS.IMODELJS_CORE_DIRNAME, "core/backend/lib/test/assets/test.bim");

function waitUntilTimeHasPassed() {
  const ot = Date.now();
  let nt = ot;
  while (nt <= ot) {
    nt = Date.now();
  }
}

describe("FeatureOverrides tests", () => {
  let imodel: IModelConnection;
  let spatialView: SpatialViewState;
  let vp: ScreenViewport;

  const viewDiv = document.createElement("div") as HTMLDivElement;
  assert(null !== viewDiv);
  viewDiv!.style.width = viewDiv!.style.height = "1000px";
  document.body.appendChild(viewDiv!);

  before(async () => {   // Create a ViewState to load into a Viewport
    WebGLTestContext.startup();
    imodel = await IModelConnection.openStandalone(iModelLocation);
    spatialView = await imodel.views.load("0x34") as SpatialViewState;
    spatialView.setStandardRotation(StandardViewId.RightIso);
  });

  after(async () => {
    if (imodel) await imodel.closeStandalone();
    WebGLTestContext.shutdown();
  });

  it("should create a uniform feature overrides object", () => {
    if (!IModelApp.hasRenderSystem) {
      return;
    }

    const vpView = spatialView.clone<SpatialViewState>();
    vp = ScreenViewport.create(viewDiv!, vpView);

    vp.target.setHiliteSet(new Set<string>());
    const ovr = FeatureOverrides.createFromTarget(vp.target as Target);
    const tbl = new FeatureTable(1);
    tbl.insertWithIndex(new Feature(new Id64("0x1")), 0);
    ovr.initFromMap(tbl);

    waitUntilTimeHasPassed(); // must wait for time to pass in order for hilite to work

    expect(ovr.isUniform).to.be.true; // should be a uniform because only 1 feature in table

    // set something hilited; should be overridden
    expect(ovr.anyHilited).to.be.false;
    const hls = new Set<string>(); hls.add("0x1");
    vp.target.setHiliteSet(hls);
    ovr.update(tbl);
    expect(ovr.anyHilited).to.be.true;
  });

  it("should create a non-uniform feature overrides object", () => {
    if (!IModelApp.hasRenderSystem)
      return;

    const vpView = spatialView.clone<SpatialViewState>();
    vp = ScreenViewport.create(viewDiv!, vpView);

    vp.target.setHiliteSet(new Set<string>());
    const ovr = FeatureOverrides.createFromTarget(vp.target as Target);
    const tbl = new FeatureTable(2);
    tbl.insertWithIndex(new Feature(new Id64("0x1")), 0);
    tbl.insertWithIndex(new Feature(new Id64("0x2")), 1);
    ovr.initFromMap(tbl);

    waitUntilTimeHasPassed(); // must wait for time to pass in order for hilite to work

    expect(ovr.isNonUniform).to.be.true; // should be a uniform because 2 features in table

    // set something hilited; should be overridden
    expect(ovr.anyHilited).to.be.false;
    const hls = new Set<string>(); hls.add("0x1");
    vp.target.setHiliteSet(hls);
    ovr.update(tbl);
    expect(ovr.anyHilited).to.be.true;
  });
});

describe("FeatureTable tests", () => {
  it("should pack and unpack a FeatureTable", () => {
    const features: Feature[] = [
      new Feature("0x1", "0x1", GeometryClass.Primary),
      new Feature("0x2", "0x1", GeometryClass.Primary),
      new Feature("0x3", "0x1", GeometryClass.Construction),
      new Feature("0x4", "0xabcdabcdabcdabcd", GeometryClass.Primary),
      new Feature("0xabcdabcdabcdabce", "0x63", GeometryClass.Construction),
      new Feature("0xabcdabcdabcdabcc", "0xc8", GeometryClass.Primary),
      new Feature("0xabcdabcdabcdabc7", "0xabcdabcdabcdabd1", GeometryClass.Construction),
      new Feature("0x2", "0xabcdabcdabcdabcd", GeometryClass.Primary),
      new Feature("0x1", "0x1", GeometryClass.Construction),
    ];

    const table = new FeatureTable(100, new Id64("0x1234"));
    for (const feature of features) {
      let testId = new Id64(feature.elementId);
      expect(testId.isValid).to.be.true;
      testId = new Id64(feature.subCategoryId);
      expect(testId.isValid).to.be.true;

      table.insert(feature);
    }

    expect(table.length).to.equal(features.length);

    const packed = PackedFeatureTable.pack(table);
    const unpacked = packed.unpack();

    expect(table.length).to.equal(unpacked.length);
    expect(table.maxFeatures).to.equal(unpacked.maxFeatures);
    expect(table.modelId.toString()).to.equal(unpacked.modelId.toString());
    expect(table.isUniform).to.equal(unpacked.isUniform);

    for (let i = 0; i < table.length; i++) {
      const lhs = table.getArray()[i];
      const rhs = unpacked.getArray()[i];

      expect(lhs.index).to.equal(rhs.index);
      expect(lhs.value.geometryClass).to.equal(rhs.value.geometryClass);
      expect(lhs.value.elementId).to.equal(rhs.value.elementId);
      expect(lhs.value.subCategoryId).to.equal(rhs.value.subCategoryId);
    }
  });
});
