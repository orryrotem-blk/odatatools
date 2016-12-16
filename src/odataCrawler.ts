import { Client } from 'node-rest-client';
import { window, TextEdit, Range, commands } from 'vscode';

interface EdmxBase {
    
}

interface Edmx extends EdmxBase {
    $: {
        Version: string;
        "xmlns:edmx": string;
    }
    "edmx:DataServices": { Schema: Schema[] };
}

interface Schema extends EdmxBase {
    $: { Namespace: string; }
    ComplexType: ComplexType[];
    EntityType: EntityType[];
    EnumType: EnumType[];
}

interface EnumType {
    $: { Name: string; }
    Member: {
        $: {
            Name: string;
            Value: number;
        }
    }[]
}

interface NavigationProperty {
    ReferentialConstraint?: {
        $: {
            Name: string;
            Type: string;
            Property: string;
            ReferencedProperty: string;
        }
    }
}

interface ComplexType extends EdmxBase {
    $: { Name: string; }
    Property: Property[];
}

interface Property extends EdmxBase {
    $: {
        Name: string;
        Type: string;
        Nullable?: boolean;
    }
}

interface EntityType extends ComplexType {
    Key?: { PropertyRef: { $: { Name: string } } }[];
    NavigationProperty: NavigationProperty[];
}

var lastval: string = null;

export async function getInterfaces() {
    let input = await window.showInputBox({
        placeHolder: "http://my.odata.service/service.svc",
        value: lastval,
        prompt: "Please enter uri of your oData service."
    });

    if(!input)
        return;

    input = input.replace("$metadata", "");
    if(input.endsWith("/"))
        input = input.substr(0, input.length-1);

    input = input + "/$metadata";

    lastval = input;

    let client = new Client();
    client.get(input, (data, response) => {
        try {
            if(!data["edmx:Edmx"]) {
                console.error("Received invalid data:\n", data);
                return window.showErrorMessage("Response is not valid oData metadata. See console for more information");
            }
            let edmx: Edmx = data["edmx:Edmx"];
            let version = edmx.$.Version;
            if(version!="4.0")
                return window.showErrorMessage("Metadata is not valid Odata Version. Only 4.0 supported.");
            let interfacesstring = getInterfacesString(edmx["edmx:DataServices"][0].Schema);

            interfacesstring += edmTypes();

            if(!window.activeTextEditor)
                return window.showErrorMessage("No active window selected.");
            window.activeTextEditor.edit((editBuilder) => {
                editBuilder.replace(window.activeTextEditor.selection, interfacesstring);
            }).then((value) => {
                commands.executeCommand("editor.action.formatDocument");
            });
            
        } catch (error) {
            console.error("Unknown error:\n", error.toString())
            window.showErrorMessage("Unknown error occurred, see console output for more information.");
        }
    })
}

var typedefs = {
    Duration: "string",
    Binary: "string",
    Boolean: "boolean",
    Byte: "number",
    Date: "string",
    DateTimeOffset: "string",
    Decimal: "number",
    Double: "number",
    Guid: "string",
    Int16: "number",
    Int32: "number",
    Int64: "number",
    SByte: "number",
    Single: "number",
    String: "string",
    TimeOfDay: "string"
}

function edmTypes(): string {
    let input = "\n";
    input += "namespace Edm {\n";
    for(let key in typedefs)
        input += "export type "+key+" = "+typedefs[key]+";\n";
    input += "}";
    return input;
}

function getInterfacesString(schemas: Schema[]): string {
    let ret = "";
    for(let schema of schemas) {
        ret += "namespace " + schema.$.Namespace + " {\n";
        if(schema.EntityType)
            for(let type of schema.EntityType) {
                ret += "export interface " + type.$.Name + " {\n";
                if(type.Property)
                    for(let prop of type.Property)
                        ret += getProperty(prop);
                if(type.NavigationProperty)
                    for(let prop of type.NavigationProperty)
                        ret += getProperty(prop);
                ret += "}\n";
            }
        if(schema.ComplexType)
            for(let type of schema.ComplexType) {
                ret += "export interface " + type.$.Name + " {\n";
                if(type.Property)
                    for(let prop of type.Property)
                        ret += getProperty(prop);
                ret += "}\n";
            }
        if(schema.EnumType)
            for(let enumtype of schema.EnumType) {
                ret += "export enum " + enumtype.$.Name + " {\n";
                let i = 0;
                if(enumtype.$.Name)
                    for(let member of enumtype.Member)
                        ret += member.$.Name + " = " + member.$.Value + (++i < enumtype.Member.length ? "," : "")
                ret += "}\n";
            }
        ret += "}\n";
    }
    return ret;
}

function getType(typestring: string): string {
    let m = typestring.match(/Collection\(.*\)/);
    if(m) {
        checkEdmType(m[1]);
        return m[1] + "[]";
    }
    checkEdmType(typestring);
    return typestring;
}

function checkEdmType(typestring: string) {
    if(!typestring)
        return;
    if(!typestring.startsWith("Edm."))
        return;
    let typename = typestring.replace("Edm.", "");
    if(!typedefs[typename])
        typedefs[typename] = "any";
}

function getProperty(inprop: Property | NavigationProperty) {
    let prop = inprop as Property;
    if(typeof inprop === 'NavigationProperty')
        prop.$.Nullable = true;
    return prop.$.Name + (typeof prop.$.Nullable !== 'undefined' ? (prop.$.Nullable ? "" : "?") : "?") + ": " + getType(prop.$.Type) + ";\n"
}