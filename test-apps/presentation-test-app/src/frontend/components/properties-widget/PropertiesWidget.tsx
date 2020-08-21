/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import "./PropertiesWidget.css";
import * as React from "react";
import { IModelApp, IModelConnection } from "@bentley/imodeljs-frontend";
import { Field } from "@bentley/presentation-common";
import {
  IPresentationPropertyDataProvider, PresentationPropertyDataProvider, propertyGridWithUnifiedSelection,
} from "@bentley/presentation-components";
import { Presentation } from "@bentley/presentation-frontend";
import { PropertyRecord } from "@bentley/ui-abstract";
import {
  ActionButtonRendererProps, PropertyCategory, PropertyData, PropertyGrid, PropertyGridContextMenuArgs, useAsyncValue,
} from "@bentley/ui-components";
import { ContextMenuItem, ContextMenuItemProps, GlobalContextMenu, Orientation } from "@bentley/ui-core";

/* eslint-disable deprecation/deprecation */

// eslint-disable-next-line @typescript-eslint/naming-convention
const SamplePropertyGrid = propertyGridWithUnifiedSelection(PropertyGrid);

export interface Props {
  imodel: IModelConnection;
  rulesetId: string;
  onFindSimilar?: (propertiesProvider: IPresentationPropertyDataProvider, record: PropertyRecord) => void;
}

type ContextMenuItemInfo = ContextMenuItemProps & React.Attributes & { label: string };

export interface State {
  dataProvider: PresentationPropertyDataProvider;
  contextMenu?: PropertyGridContextMenuArgs;
  contextMenuItemInfos?: ContextMenuItemInfo[];
}
export default class PropertiesWidget extends React.Component<Props, State> {
  constructor(props: Props, context?: any) {
    super(props, context);
    this.state = {
      dataProvider: createDataProvider(this.props.imodel, this.props.rulesetId),
    };
  }
  public static getDerivedStateFromProps(props: Props, state: State) {
    if (props.imodel !== state.dataProvider.imodel || props.rulesetId !== state.dataProvider.rulesetId)
      return { ...state, dataProvider: createDataProvider(props.imodel, props.rulesetId) };
    return null;
  }
  private _onFindSimilar = (property: PropertyRecord) => {
    if (this.props.onFindSimilar)
      this.props.onFindSimilar(this.state.dataProvider, property);
    this.setState({ contextMenu: undefined });
  }
  private _onAddFavorite = async (propertyField: Field) => {
    await Presentation.favoriteProperties.add(propertyField);
    this.setState({ contextMenu: undefined });
  }
  private _onRemoveFavorite = async (propertyField: Field) => {
    await Presentation.favoriteProperties.remove(propertyField);
    this.setState({ contextMenu: undefined });
  }
  private _onPropertyContextMenu = (args: PropertyGridContextMenuArgs) => {
    args.event.persist();
    this.setState({ contextMenu: args });
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.buildContextMenu(args);
  }
  private _onContextMenuOutsideClick = () => {
    this.setState({ contextMenu: undefined });
  }
  private _onContextMenuEsc = () => {
    this.setState({ contextMenu: undefined });
  }
  private async buildContextMenu(args: PropertyGridContextMenuArgs) {
    const field = await this.state.dataProvider.getFieldByPropertyRecord(args.propertyRecord);
    const items: ContextMenuItemInfo[] = [];
    if (field !== undefined) {
      if (Presentation.favoriteProperties.has(field)) {
        items.push({
          key: "remove-favorite",
          onSelect: async () => this._onRemoveFavorite(field),
          title: IModelApp.i18n.translate("Sample:controls.properties.context-menu.remove-favorite.description"),
          label: IModelApp.i18n.translate("Sample:controls.properties.context-menu.remove-favorite.label"),
        });
      } else {
        items.push({
          key: "add-favorite",
          onSelect: async () => this._onAddFavorite(field),
          title: IModelApp.i18n.translate("Sample:controls.properties.context-menu.add-favorite.description"),
          label: IModelApp.i18n.translate("Sample:controls.properties.context-menu.add-favorite.label"),
        });
      }
    }

    if (this.props.onFindSimilar) {
      items.push({
        key: "find-similar",
        onSelect: () => this._onFindSimilar(args.propertyRecord),
        title: IModelApp.i18n.translate("Sample:controls.properties.context-menu.find-similar.description"),
        label: IModelApp.i18n.translate("Sample:controls.properties.context-menu.find-similar.label"),
      });
    }
    this.setState({ contextMenuItemInfos: items.length > 0 ? items : undefined });
  }

  private renderContextMenu() {
    if (!this.state.contextMenu || !this.state.contextMenuItemInfos)
      return undefined;

    const items: React.ReactNode[] = [];
    this.state.contextMenuItemInfos.forEach((info: ContextMenuItemInfo) => (
      items.push(
        <ContextMenuItem
          key={info.key}
          onSelect={info.onSelect}
          title={info.title}
        >
          {info.label}
        </ContextMenuItem>,
      )
    ));

    return (
      <GlobalContextMenu
        opened={true}
        onOutsideClick={this._onContextMenuOutsideClick}
        onEsc={this._onContextMenuEsc}
        identifier="PropertiesWidget"
        x={this.state.contextMenu!.event.clientX}
        y={this.state.contextMenu!.event.clientY}
      >
        {items}
      </GlobalContextMenu>
    );
  }

  private _favoriteActionButtonRenderer = (props: ActionButtonRendererProps) => {
    const { dataProvider } = this.state;
    const { property } = props;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const field = useAsyncValue(React.useMemo(async () => dataProvider.getFieldByPropertyRecord(property), [dataProvider, property]));

    return (
      <div>
        {
          field &&
          (Presentation.favoriteProperties.has(field) || props.isPropertyHovered) &&
          <FavoriteActionButton
            field={field} />
        }
      </div>
    );
  }

  private _copyActionButtonRenderer = (_: ActionButtonRendererProps) => {
    return <CopyActionButton />;
  }

  public render() {
    return (
      <div className="PropertiesWidget">
        <h3>{IModelApp.i18n.translate("Sample:controls.properties.widget-label")}</h3>
        <div className="ContentContainer">
          <SamplePropertyGrid
            dataProvider={this.state.dataProvider}
            isPropertyHoverEnabled={true}
            onPropertyContextMenu={this._onPropertyContextMenu}
            actionButtonRenderers={[this._favoriteActionButtonRenderer, this._copyActionButtonRenderer]}
            orientation={Orientation.Horizontal}
            horizontalOrientationMinWidth={500}
          />
        </div>
        {this.renderContextMenu()}
      </div>
    );
  }
}

class FavoriteActionButton extends React.Component<{ field: Field }> {

  private _isMounted = false;

  public componentDidMount() {
    this._isMounted = true;
  }

  public componentWillUnmount() {
    this._isMounted = false;
  }

  public render() {
    return (
      <div className="favorite-action-button" onClick={this._onActionButtonClicked}>
        {this.isFavorite() ?
          <div style={{ width: "20px", height: "20px", background: "orange" }} /> :
          <div style={{ width: "20px", height: "20px", background: "blue" }} />}
      </div>
    );
  }

  private _onActionButtonClicked = () => {
    this.toggleFavoriteProperty(); // eslint-disable-line @typescript-eslint/no-floating-promises
  }

  private async toggleFavoriteProperty() {
    if (this.isFavorite())
      await Presentation.favoriteProperties.remove(this.props.field);
    else
      await Presentation.favoriteProperties.add(this.props.field);
    if (this._isMounted)
      this.setState({ isFavorite: this.isFavorite() });
  }

  private isFavorite(): boolean {
    return Presentation.favoriteProperties.has(this.props.field);
  }
}

class CopyActionButton extends React.Component {
  public render() {
    return (
      <div className="copy-action-button" style={{ height: "20px" }}>
        Copy
      </div>
    );
  }
}

class AutoExpandingPropertyDataProvider extends PresentationPropertyDataProvider {
  public async getData(): Promise<PropertyData> {
    const result = await super.getData();
    this.expandCategories(result.categories);
    return result;
  }
  private expandCategories(categories: PropertyCategory[]) {
    categories.forEach((category: PropertyCategory) => {
      category.expand = true;
      if (category.childCategories)
        this.expandCategories(category.childCategories);
    });
  }
}

function createDataProvider(imodel: IModelConnection, rulesetId: string): PresentationPropertyDataProvider {
  const provider = new AutoExpandingPropertyDataProvider({ imodel, ruleset: rulesetId });
  provider.isNestedPropertyCategoryGroupingEnabled = true;
  return provider;
}
