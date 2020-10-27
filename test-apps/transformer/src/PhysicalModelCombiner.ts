/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { DbResult, Id64, Id64Set, Id64String, Logger } from "@bentley/bentleyjs-core";
import {
  BackendLoggerCategory, BackendRequestContext, ECSqlStatement, Element, ElementRefersToElements, IModelDb, IModelJsFs, IModelTransformer,
  PhysicalModel, PhysicalPartition, Relationship, SnapshotDb, SubCategory, Subject,
} from "@bentley/imodeljs-backend";
import { CreateIModelProps } from "@bentley/imodeljs-common";

export class PhysicalModelCombiner extends IModelTransformer {
  public static async combine(sourceFileName: string, targetFileName: string): Promise<void> {
    const sourceDb = SnapshotDb.openFile(sourceFileName);
    if (IModelJsFs.existsSync(targetFileName)) {
      IModelJsFs.removeSync(targetFileName);
    }
    const targetDbProps: CreateIModelProps = {
      rootSubject: { name: "Combine-PhysicalModels-Target" },
      ecefLocation: sourceDb.ecefLocation,
    };
    const targetDb = SnapshotDb.createEmpty(targetFileName, targetDbProps);
    const combiner = new PhysicalModelCombiner(sourceDb, targetDb);
    await combiner.processSchemas(new BackendRequestContext());
    combiner.combine();
    combiner.dispose();
    sourceDb.close();
    targetDb.close();
  }
  private _numSourceElements = 0;
  private _numSourceElementsProcessed = 0;
  private _numSourceRelationships = 0;
  private _numSourceRelationshipsProcessed = 0;
  private readonly _reportingInterval = 1000;
  private readonly _saveChangesInterval = 10000; // must be a multiple of reportingInterval
  private _childPhysicalPartitionIds: Id64Set = new Set<Id64String>();
  private _targetComponentsModelId: Id64String = Id64.invalid;
  private _targetPhysicalTagsModelId: Id64String = Id64.invalid;
  private _startTime = new Date();
  public constructor(sourceDb: IModelDb, targetDb: IModelDb) {
    super(sourceDb, targetDb, { cloneUsingBinaryGeometry: true, noProvenance: true });
    this._numSourceElements = sourceDb.withPreparedStatement(`SELECT COUNT(*) FROM ${Element.classFullName}`, (statement: ECSqlStatement): number => {
      return DbResult.BE_SQLITE_ROW === statement.step() ? statement.getValue(0).getInteger() : 0;
    });
    Logger.logInfo("Progress", `numSourceElements=${this._numSourceElements}`);
    this._numSourceRelationships = sourceDb.withPreparedStatement(`SELECT COUNT(*) FROM ${ElementRefersToElements.classFullName}`, (statement: ECSqlStatement): number => {
      return DbResult.BE_SQLITE_ROW === statement.step() ? statement.getValue(0).getInteger() : 0;
    });
    Logger.logInfo("Progress", `numSourceRelationships=${this._numSourceRelationships}`);
  }
  public combine(): void {
    this.exporter.visitRelationships = false;
    this.initSubCategoryFilter();
    this.importer.simplifyElementGeometry = true;
    this.processAll();
    this.targetDb.saveChanges(`Finished processing non-physical models`);
    this._childPhysicalPartitionIds.forEach((partitionId: Id64String) => {
      this.processModel(partitionId);
      this.targetDb.saveChanges(`Finished processing PhysicalPartition ${partitionId}`);
    });
    this.exporter.visitRelationships = true;
    this.processRelationships(ElementRefersToElements.classFullName);
    this.targetDb.saveChanges(`Finished processing relationships`);
  }
  protected shouldExportElement(sourceElement: Element): boolean {
    if (!this.importer.simplifyElementGeometry) {
      this.importer.simplifyElementGeometry = true; // turn back on simplification
      Logger.logInfo(BackendLoggerCategory.IModelImporter, "Turn back on element geometry simplification");
    }
    ++this._numSourceElementsProcessed;
    if (0 === this._numSourceElementsProcessed % this._reportingInterval) {
      const progressMessage = `Processed ${this._numSourceElementsProcessed} of ${this._numSourceElements} elements`;
      Logger.logInfo("Progress", progressMessage);
      this.logElapsedTime();
      this.logMemoryUsage();
      if (0 === this._numSourceElementsProcessed % this._saveChangesInterval) {
        Logger.logInfo("Progress", "Saving changes");
        this.targetDb.saveChanges();
      }
    }
    if (sourceElement instanceof Subject) {
      if (sourceElement.code.getValue() === "Physical") { // FMG case
        const targetPartitionId = PhysicalModel.insert(this.targetDb, this.context.findTargetElementId(sourceElement.parent!.id), "Combined Physical");
        this.importer.doNotUpdateElementIds.add(targetPartitionId);
        this.forEachChildPhysicalPartition(sourceElement.id, (sourcePartitionId: Id64String) => {
          this.context.remapElement(sourcePartitionId, targetPartitionId);
          this._childPhysicalPartitionIds.add(sourcePartitionId);
        });
        return false;
      }
    } else if (sourceElement instanceof PhysicalPartition) {
      if ("PDMxPhysical-Tag" === sourceElement.code.getValue()) { // Shell case
        if (Id64.invalid === this._targetPhysicalTagsModelId) {
          this._targetPhysicalTagsModelId = PhysicalModel.insert(this.targetDb, this.context.findTargetElementId(sourceElement.parent!.id), sourceElement.code.getValue());
          this.importer.doNotUpdateElementIds.add(this._targetPhysicalTagsModelId);
        }
        this.context.remapElement(sourceElement.id, this._targetPhysicalTagsModelId);
      } else if ("Components" === sourceElement.code.getValue()) {
        if (Id64.invalid === this._targetComponentsModelId) {
          this._targetComponentsModelId = PhysicalModel.insert(this.targetDb, this.context.findTargetElementId(sourceElement.parent!.id), sourceElement.code.getValue());
          this.importer.doNotUpdateElementIds.add(this._targetComponentsModelId);
        }
        this.context.remapElement(sourceElement.id, this._targetComponentsModelId);
      }
    } else if ((Id64.invalid === this._targetPhysicalTagsModelId) && ("0x40000009395" === sourceElement.id)) { // hack for problem element in FMG dataset
      this.importer.simplifyElementGeometry = false; // temporarily turn off simplification
      Logger.logInfo(BackendLoggerCategory.IModelImporter, `Disabling element geometry simplification for ${sourceElement.id}`);
    }
    return super.shouldExportElement(sourceElement);
  }
  private forEachChildPhysicalPartition(parentSubjectId: Id64String, fn: (partitionId: Id64String) => void): void {
    const partitionSql = `SELECT ECInstanceId FROM ${PhysicalPartition.classFullName} WHERE Parent.Id=:parentId`;
    this.sourceDb.withPreparedStatement(partitionSql, (statement: ECSqlStatement): void => {
      statement.bindId("parentId", parentSubjectId);
      while (DbResult.BE_SQLITE_ROW === statement.step()) {
        const partitionId = statement.getValue(0).getId();
        fn(partitionId);
      }
    });
    const subjectSql = `SELECT ECInstanceId FROM ${Subject.classFullName} WHERE Parent.Id=:parentId`;
    this.sourceDb.withPreparedStatement(subjectSql, (statement: ECSqlStatement): void => {
      statement.bindId("parentId", parentSubjectId);
      while (DbResult.BE_SQLITE_ROW === statement.step()) {
        const subjectId = statement.getValue(0).getId();
        this.forEachChildPhysicalPartition(subjectId, fn);
      }
    });
  }
  private initSubCategoryFilter(): void { // only relevant for Shell case
    const sql = `SELECT ECInstanceId FROM ${SubCategory.classFullName} WHERE CodeValue='Obstruction' OR CodeValue='Insulation'`;
    this.sourceDb.withPreparedStatement(sql, (statement: ECSqlStatement): void => {
      while (DbResult.BE_SQLITE_ROW === statement.step()) {
        const subCategoryId = statement.getValue(0).getId();
        this.context.filterSubCategory(subCategoryId);
        this.exporter.excludeElement(subCategoryId);
      }
    });
  }
  protected shouldExportRelationship(relationship: Relationship): boolean {
    ++this._numSourceRelationshipsProcessed;
    if (0 === this._numSourceRelationshipsProcessed % this._reportingInterval) {
      const progressMessage = `Processed ${this._numSourceRelationshipsProcessed} of ${this._numSourceRelationships} relationships`;
      Logger.logInfo("Progress", progressMessage);
      this.logElapsedTime();
      this.logMemoryUsage();
      if (0 === this._numSourceRelationshipsProcessed % this._saveChangesInterval) {
        Logger.logInfo("Progress", "Saving changes");
        this.targetDb.saveChanges(progressMessage);
      }
    }
    return super.shouldExportRelationship(relationship);
  }
  private logMemoryUsage(): void {
    const used: any = process.memoryUsage();
    const values: string[] = [];
    // eslint-disable-next-line guard-for-in
    for (const key in used) {
      values.push(`${key}=${Math.round(used[key] / 1024 / 1024 * 100) / 100}MB `);
    }
    Logger.logInfo("Memory", `Memory: ${values.join()}`);
  }
  private logElapsedTime(): void {
    const elapsedTimeMinutes: number = (new Date().valueOf() - this._startTime.valueOf()) / 60000.0;
    Logger.logInfo("Progress", `Elapsed time: ${Math.round(100 * elapsedTimeMinutes) / 100.0} minutes`);
  }
}