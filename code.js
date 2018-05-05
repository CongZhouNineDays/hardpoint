var hashString = function(str) {
	let hash = 0;
	if (!str) {
		return hash;
	}

	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		hash = (hash * 31) + c;
		hash |= 0;
	}

	return hash;
};

var hashAndEncode = function(str) {
	 const hash = hashString(str);

	 // Limit to 24 bits for nice alignment with four base64 characters.
	 const unencoded =
		String.fromCharCode((hash & 0xff0000) >> 16) +
		String.fromCharCode((hash & 0xff00) >> 8) +
		String.fromCharCode(hash & 0xff);

	return btoa(unencoded).replace(/\+/g, '-').replace(/\//g, '_');
}

// Limited to ints between 0 and 25.
var encodeSmallInt = function(num) {
	const start = "A";
	return String.fromCharCode(start.charCodeAt(0) + num);
}

var decodeSmallInt = function(str) {
	const start = "A";
	const num = str.charCodeAt(0);
	return num - start.charCodeAt(0);
}


class ShipId {
	constructor(specificationId, modificationId, loadoutId) {
		this.specificationId = specificationId;
		this.modificationId = modificationId;
		this.loadoutId = loadoutId;
	}

	serialize() {
		return hashAndEncode(this.specificationId) + hashAndEncode(this.modificationId) + hashAndEncode(this.loadoutId);
	}

	static deserialize(str) {
		const hashedSpecificationId = str.substr(0, 4);
		const hashedModificationId = str.substr(4, 4);
		const hashedLoadoutId = str.substr(8, 4);

		const specificationId = Object.keys(shipSpecifications).find(n => hashAndEncode(n) == hashedSpecificationId);

		return new ShipId(
			specificationId,
			shipSpecifications[specificationId].modificationIds.find(n => hashAndEncode(n) == hashedModificationId),
			Object.keys(shipLoadouts).find(n => hashAndEncode(n) == hashedLoadoutId));
	}

	static findLoadout(specificationId, modificationId) {
		// This is crazy -- must be missing something about how loadouts are bound to ships.
		let loadoutId;
		const tryLoadoutId = id => {
			if (!loadoutId) {
				if (shipLoadouts[id]) {
					loadoutId = id;
				}
			}
		}

		const specificationData = shipSpecifications[specificationId]._data;
		if (modificationId) {
			tryLoadoutId(specificationId + "_" + modificationId);

			const patchFile = specificationData["Modifications"][modificationId]["@patchFile"];
			if (patchFile) {
				const fileName = patchFile.split("/").pop();
				tryLoadoutId(fileName + "_" + modificationId);
				tryLoadoutId(fileName);
			}
		}
		else
		{
			tryLoadoutId(specificationId);
			if (specificationData["@local"]) {
				// The worst hack of this mess, but necessary for the Constellation Andromeda.
				tryLoadoutId(specificationData["@local"].replace(/ /g, "_"));
			}
		}

		return new ShipId(specificationId, modificationId, loadoutId);
	}
}

class ShipSpecification {
	constructor(data) {
		this._data = data;

		this._itemPorts = this._findItemPorts(undefined);
		this._modificationItemPorts = {};
		this.modificationIds.forEach(n => this._modificationItemPorts[n] = this._findItemPorts(n));
	}

	get tags() {
		if (this._data["@itemPortTags"]) {
			return this._data["@itemPortTags"].split(" ");
		}

		return [];
	}

	get modificationIds() {
		return Object.keys(this._data["Modifications"] || {});
	}

	getDisplayName(modificationId) {
		// This looks like a complete mess...
		return undefined;
	}

	getItemPorts(modificationId) {
		if (modificationId) {
			return this._modificationItemPorts[modificationId];
		}

		return this._itemPorts;
	}

	getModificationLoadouts() {
		const modifications = [undefined].concat(this.modificationIds);
		let results = modifications.map(x => ShipId.findLoadout(this._data["@name"], x));

		// Filter out anything that doesn't have a valid loadout.
		results = results.filter(n => n.loadoutId);

		return results;
	}

	getAttributes(modificationId) {
		return [
			{
				name: "Normal Speed",
				category: "Maneuverability",
				value: Number(this._data["ifcs"]["@SCMVelocity"]) || 0
			},
			{
				name: "Afterburner Speed",
				category: "Maneuverability",
				value: Number(this._data["ifcs"]["@CruiseSpeed"]) || 0
			},
			{
				name: "Total Hitpoints",
				category: "Survivability",
				value: this._findParts(modificationId).reduce((total, x) => total + Number(x["@damageMax"] || 0), 0)
			}
		];
	}

	_findParts(modificationId, className = undefined) {
		let unsearched = [this._data["Parts"]["Part"]];
		if (modificationId) {
			const modification = this._data["Modifications"][modificationId];
			if (modification["mod"] && modification["mod"]["Parts"]) {
				unsearched = [modification["mod"]["Parts"]["Part"]];
			}
		}

		let result = [];
		while (unsearched.length > 0) {
			const potential = unsearched.pop();

			if (!className || potential["@class"] == className) {
				result.push(potential);
			}

			if (potential["Parts"] && potential["Parts"]["Part"])
			{
				if (Array.isArray(potential["Parts"]["Part"])) {
					potential["Parts"]["Part"].forEach(n => unsearched.push(n));
				}
				else {
					unsearched.push(potential["Parts"]["Part"]);
				}
			}
		}

		return result;
	}

	_findItemPorts(modificationId = undefined) {
		const itemPorts = this._findParts(modificationId, "ItemPort");

		return itemPorts.filter(n => n["ItemPort"]).map(function (part) {
			return new SpaceshipItemPort(part["ItemPort"], part["@name"]);
		});
	}
}

class DamageQuantity {
	constructor(distortion, energy, physical, thermal) {
		const makeNumber = x => Number(x) || 0;

		this._values = [makeNumber(distortion), makeNumber(energy), makeNumber(physical), makeNumber(thermal)];
	}

	get distortion() {
		return this._values[0];
	}

	get energy() {
		return this._values[1];
	}

	get physical() {
		return this._values[2];
	}

	get thermal() {
		return this._values[3];
	}

	get total() {
		return this._values.reduce((total, x) => total + x, 0);
	}

	get type() {
		const count = this._values.reduce((total, x) => x > 0 ? total + 1 : total, 0);
		if (count > 1) {
			return "mixed"
		}
		else if (this.distortion > 0) {
			return "distortion";
		}
		else if (this.energy > 0) {
			return "energy";
		}
		else if (this.physical > 0) {
			return "physical";
		}
		else if (this.thermal > 0) {
			return "thermal";
		}
		else {
			return "none";
		}
	}

	add(quantity) {
		return DamageQuantity._fromValues(this._values.map((x, index) => x + quantity._values[index]));
	}

	scale(coefficient) {
		return DamageQuantity._fromValues(this._values.map(x => x * coefficient));
	}

	static _fromValues(values) {
		return new DamageQuantity(values[0], values[1], values[2], values[3]);
	}
}

class SummaryText {
	constructor(patterns, values) {
		this.patterns = patterns;
		this.values = values;

		if (!this.patterns) {
			this.patterns = ["Boring"];
		}
	}

	render() {
		let getValue = key => {
			const split = key.split(".");

			let value = this.values;
			split.forEach(n => {
				if (n.startsWith("[")) {
					const index = Number(n.slice(1, -1));
					value = value[index];
				}
				else {
					value = value[n]
				}
			});

			if (value.toFixed) {
				// Round to two places and then drop any trailing 0s.
				value = +value.toFixed(2);
			}

			return '<span class="summary-value">' + value + '</span>';
		};

		const expanded = this.patterns.map(p => {
			const replaced = p.replace(/{[^}]+}/g, n => getValue(n.slice(1, -1)));
			return "<p>" + replaced + "</p>";
		}).join("");

		return '<span class="summary">' + expanded + '</span>';
	}
}

class SpaceshipComponent {
	constructor(data) {
		this._data = data;

		this.itemPorts = this._findItemPorts();
	}

	get displayName() {
		return localizationItems[this.name] || this.name;
	}

	get name() {
		return this._data["@name"];
	}

	get type() {
		return this._data["@itemType"];
	}

	get subtype() {
		return this._data["@itemSubType"];
	}

	get size() {
		return this._data["@itemSize"];
	}

	get requiredTags() {
		if (!this._data["@requiredPortTags"]) {
			return [];
		}

		return this._data["@requiredPortTags"].split(" ");
	}

	get bulletSpeed() {
		if (this.type == "WeaponGun") {
			const ammo = this._data["ammo"];
			if (!ammo) {
				return 0;
			}

			return ammo["@speed"];
		}

		return 0;
	}

	get bulletDuration() {
		if (this.type == "WeaponGun") {
			const ammo = this._data["ammo"];
			if (!ammo) {
				return 0;
			}

			return ammo["@lifetime"];
		}

		return 0;
	}

	get bulletRange() {
		return this.bulletSpeed * this.bulletDuration;
	}

	get bulletCount() {
		if (this.type == "WeaponGun") {
			const shotgun = this._data["firemodes"]["shotgun"];
			if (shotgun) {
				return Number(shotgun["pellets"]) || 0;
			}
			return 1;
		}

		return 0;
	}

	get gunAlpha() {
		if (this.type == "WeaponGun") {
			const ammo = this._data["ammo"];
			if (!ammo) {
				return new DamageQuantity(0, 0, 0, 0);
			}

			const detonation = ammo["bullet"]["detonation"];
			let damageInfo;
			if (detonation) {
				damageInfo = detonation["explosion"]["damage"]["DamageInfo"];
			}
			else {
				damageInfo = ammo["bullet"]["damage"]["DamageInfo"];
			}

			return new DamageQuantity(
				damageInfo["@DamageDistortion"],
				damageInfo["@DamageEnergy"],
				damageInfo["@DamagePhysical"],
				damageInfo["@DamageThermal"]);
		}

		return new DamageQuantity(0, 0, 0, 0);
	}

	get gunFireRate() {
		if (this.type == "WeaponGun") {
			return Number(this._data["firemodes"]["fire"]["rate"]) || 0;
		}

		return 0;
	}

	get gunBurstDps() {
		const scaled = this.gunAlpha.scale(this.bulletCount + this.gunFireRate / 60.0);
		return scaled;
	}

	get gunSustainedDps() {
		// TODO Actually calculate heat and energy limits based on ship equipment.
		if (this.type == "WeaponGun") {
			const derived = this._data["derived"];
			const quantity = new DamageQuantity(
				derived["dps_60s_dmg_dist"],
				derived["dps_60s_dmg_enrg"],
				derived["dps_60s_dmg_phys"],
				derived["dps_60s_dmg_thrm"]);

			return quantity;
		}

		return new DamageQuantity(0, 0, 0, 0);
	}

	get missileDamage() {
		if (this.type == "Ordinance") {
			const explosion = this._data["explosion"];
			const quantity = new DamageQuantity(
				explosion["damage_distortion"],
				explosion["damage_energy"],
				explosion["damage"],
				0);

			return quantity;
		}

		return new DamageQuantity(0, 0, 0, 0);
	}

	get missileRange() {
		if (this.type == "Ordinance") {
			return this._data["derived"]["max_range"];
		}

		return 0;
	}

	get missileGuidance() {
		if (this.type == "Ordinance") {
			return this._data["missile"]["MGCS"]["tracking"]["signalType"];
		}

		return "";
	}

	get shieldCapacity() {
		return 0;
	}

	get shieldRegeneration() {
		return 0;
	}

	get shieldDownDelay() {
		return 0;
	}

	get summary() {
		if (this.type == "WeaponGun") {
			let damage = "{gunAlpha.total}";
			if (this.bulletCount > 1) {
				damage += " X {bulletCount}";
			}

			return new SummaryText([
				damage + " {gunAlpha.type} damage X {gunFireRate}rpm = {gunBurstDps.total}dps",
				"{gunSustainedDps.total} sustained dps (limited by heat)",
				"{bulletSpeed}m/s projectile speed X {bulletDuration}sec = {bulletRange}m range"], this);
		}

		if (this.type == "Ordinance") {
			return new SummaryText([
				"{missileDamage.total} {missileDamage.type} damage",
				"{missileGuidance} tracking with {missileRange}m max range"], this);
		}

		return new SummaryText();
	}

	_findItemPorts() {
		if (!this._data["ports"]) {
			return [];
		}

		return this._data["ports"].map(port => new SpaceshipItemPort(port, port["@name"]));
	}
}

class DataforgeComponent {
	constructor(data) {
		this._data = data;

		this.itemPorts = this._findItemPorts();
	}

	get displayName() {
		return localizationItems[this.name] || this.name;
	}

	get name() {
		return this._data["@name"];
	}

	get type() {
		return this._data["@type"];
	}

	get subtype() {
		return this._data["Components"]["SCItem"]["ItemDefinition"]["@SubType"];
	}

	get size() {
		return this._data["@size"];
	}

	get requiredTags() {
		const tags = this._data["Components"]["SCItem"]["ItemDefinition"]["@RequiredTags"];
		if (!tags) {
			return [];
		}

		return tags.split(" ");
	}

	get bulletSpeed() {
		return 0;
	}

	get bulletDuration() {
		return 0;
	}

	get bulletRange() {
		return 0;
	}

	get bulletCount() {
		return 0;
	}

	get gunAlpha() {
		return new DamageQuantity(0, 0, 0, 0);
	}

	get gunFireRate() {
		return 0;
	}

	get gunBurstDps() {
		return new DamageQuantity(0, 0, 0, 0);
	}

	get gunSustainedDps() {
		return new DamageQuantity(0, 0, 0, 0);
	}

	get missileDamage() {
		return new DamageQuantity(0, 0, 0, 0);
	}

	get missileRange() {
		return 0;
	}

	get missileGuidance() {
		return "";
	}

	get shieldCapacity() {
		const params = this._data["Components"]["SCItemShieldGeneratorParams"];
		if (params) {
			return Number(params["ShieldEmitterContributions"]["@MaxShieldHealth"]);
		}

		return 0;
	}

	get shieldRegeneration() {
		const params = this._data["Components"]["SCItemShieldGeneratorParams"];
		if (params) {
			return Number(params["ShieldEmitterContributions"]["@MaxShieldRegen"]);
		}

		return 0;
	}

	get shieldDownDelay() {
		const params = this._data["Components"]["SCItemShieldGeneratorParams"];
		if (params) {
			return Number(params["ShieldEmitterContributions"]["@DownedRegenDelay"]);
		}

		return 0;
	}

	get summary() {
		if (this.type == "Turret" || this.type == "TurretBase") {
			if (this.itemPorts[0]) {
				return new SummaryText(["{itemPorts.length} size {itemPorts.[0].maxSize} item ports"], this);
			}
		}

		if (this.type == "WeaponMissile") {
			return new SummaryText(["{itemPorts.length} size {itemPorts.[0].maxSize} missiles"], this);
		}

		if (this.type == "Shield") {
			return new SummaryText([
				"{shieldCapacity} shield capacity",
				"{shieldRegeneration}/sec regeneration with a {shieldDownDelay} sec delay after dropping"], this);
		}

		return new SummaryText();
	}

	_findItemPorts() {
		let ports = this._data["Components"]["SCItem"]["ItemPorts"];
		if (!ports) {
			return [];
		}

		ports = ports["SItemPortCoreParams"]["Ports"];
		if (!ports) {
			return [];
		}

		ports = ports["SItemPortDef"];
		if (!Array.isArray(ports)) {
			ports = [ports];
		}

		return ports.map(port => new DataforgeItemPort(port));
	}
}

class ItemPortType {
	constructor(type, subtypes) {
		this.type = type;

		this.subtypes = [];
		if (subtypes) {
			this.subtypes = subtypes.split(",");
		}
	}
}

class BaseItemPort {
	availableComponents(tags) {
		return Object.keys(mergedComponents).filter(n => this.matchesComponent(tags, mergedComponents[n]));
	}

	matchesType(type, subtype) {
		if (!this.types) {
			return false;
		}

		return this.types.some(function (portType) {
			if (portType.type != type) {
				return false;
			}

			// Match all subtypes when looking for interesting types.
			if (subtype != undefined) {
				// It looks like subtypes are ports constraining what components can fit,
				// the subtypes on components aren't constraints just informative.
				// TODO Or maybe I'm just missing a lot of implicit defaults and rules?
				if (portType.subtypes.length > 0) {
					if (!portType.subtypes.some(s => s == subtype)) {
						return false;
					}
				}
			}

			return true;
		});
	}

	matchesComponent(tags, component) {
		if (!this.matchesType(component.type, component.subtype)) {
			return false;
		}

		if (this.minSize != undefined && component.size < this.minSize) {
			return false;
		}

		if (this.maxSize != undefined && component.size > this.maxSize) {
			return false;
		}

		if (component.requiredTags) {
			const portTags = tags.concat(this.tags);

			for (const tag of component.requiredTags) {
				if (!portTags.includes(tag)) {
					return false;
				}
			}
		}

		return true;
	}
}

class SpaceshipItemPort extends BaseItemPort {
	constructor(data, name) {
		super();

		this._data = data;

		this.name = name;
		this.editable = !(data["@flags"] || "").includes("uneditable");
	}

	get minSize() {
		return this._data['@minsize'];
	}

	get maxSize() {
		return this._data['@maxsize'];
	}

	get tags() {
		if (this._data["@portTags"]) {
			return this._data["@portTags"].split(" ");
		}

		return [];
	}

	get types() {
		if (this._data == undefined || this._data["Types"] == undefined) {
			return [];
		}

		let types = this._data["Types"]["Type"];
		if (!Array.isArray(types)) {
			types = [types];
		}

		return types.map(x => {
			const type = x["@type"];

			// It looks like there are implicit defaults; the Sabre is an example.
			let subtypes = x["@subtypes"];
			if (!subtypes) {
				if (type == "WeaponGun") {
					subtypes = "Gun";
				}
				else if (type == "Turret") {
					subtypes = "GunTurret";
				}
			}

			return new ItemPortType(type, subtypes);
		});
	}
}

class DataforgeItemPort extends BaseItemPort {
	constructor(data) {
		super();

		this._data = data;

		this.name = data["@Name"];
		this.editable = !(data["@Flags"] || "").includes("uneditable");
	}

	get minSize() {
		return this._data['@MinSize'];
	}

	get maxSize() {
		return this._data['@MaxSize'];
	}

	get tags() {
		if (this._data["@PortTags"]) {
			return this._data["@PortTags"].split(" ");
		}

		return [];
	}

	get types() {
		const subtypes = this._data["Types"]["SItemPortDefTypes"]["SubTypes"];
		if (subtypes) {
			var subtype = subtypes["Enum"]["@value"];
		}

		const type = new ItemPortType(
			this._data["Types"]["SItemPortDefTypes"]["@Type"],
			subtype);
		return [type];
	}
}

class ItemBindingGroup {
	constructor(members) {
		this.members = members;
	}

	get name() {
		return this.members.length + this.memberPortNames.sort()[0];
	}

	get memberPortNames() {
		return this.members.map(m => m.port.name);
	}

	get allIdentical() {
		const componentsIdentical = function(left, right) {
			return _.get(left, "name") == _.get(right, "name");
		};

		const first = this.members[0];
		const firstComponent = first.selectedComponent;

		for (const other of this.members.slice(1)) {
			const otherComponent = other.selectedComponent;
			if (!componentsIdentical(firstComponent, otherComponent)) {
				return false;
			}

			// Also check the children when this is at the root level.
			// TODO Currently ignoring third-level ports.
			if (first.portPath.length == 1) {
				for (const childName of Object.keys(first.childBindings)) {
					const firstChild = first.childBindings[childName];
					const otherChild = other.childBindings[childName];
					if (!componentsIdentical(firstChild.selectedComponent, otherChild.selectedComponent)) {
						return false;
					}
				}
			}
		}

		return true;
	};

	static findGroups(bindings) {
		if (bindings == undefined) {
			return undefined;
		}

		let groups = [];
		for (const binding of bindings) {
			const groupIndex = groups.findIndex(g =>
				g[0].port.minSize == binding.port.minSize &&
				g[0].port.maxSize == binding.port.maxSize &&
				g[0].port.editable == binding.port.editable &&
				// Handle the case where uneditable item ports have different components attached.
				// TODO Consider allowing different types of turrets that share child ports to group.
				(g[0].port.editable || _.get(g[0].selectedComponent, "name") == _.get(binding.selectedComponent, "name")) &&
				_.isEqual(g[0].port.types, binding.port.types) &&
				_.isEqual(g[0].port.tags, binding.port.tags));

			if (groupIndex >= 0) {
				groups[groupIndex].push(binding);
			}
			else {
				groups.push([binding]);
			}
		}

		return groups.map(g => new ItemBindingGroup(g));
	};
}

class ItemBinding {
	constructor(port, parentBinding, loadout = undefined) {
		this.port = port;
		this.parentBinding = parentBinding;
		this.childBindings = {};

		this.defaultComponent = undefined;
		if (loadout) {
			const defaultComponentName = this._getComponentFromLoadout(loadout);
			if (defaultComponentName) {
				this.defaultComponent = mergedComponents[defaultComponentName];
			}
		}

		this._setSelectedComponent(this.defaultComponent, loadout);
	}

	get selectedComponent() {
		return this._selectedComponent;
	}

	set selectedComponent(component) {
		this._setSelectedComponent(component);
	}

	get childGroups() {
		return ItemBindingGroup.findGroups(Object.values(this.childBindings));
	}

	get customized() {
		// TODO This doesn't handle that case where a port has been set back to its default component,
		// but now has empty child ports -- it shows as not customized, although the children are changed.
		const thisCustomized = _.get(this.selectedComponent, "name") != _.get(this.defaultComponent, "name");
		return thisCustomized || Object.values(this.childBindings).some(n => n.customized);
	}

	get portPath() {
		let result = [];
		let binding = this;

		while (binding) {
			result.unshift(binding.port.name);
			binding = binding.parentBinding;
		}

		return result;
	}

	// Takes a loadout only for initial construction; changes will leave it undefined.
	_setSelectedComponent(component, loadout = undefined) {
		this._selectedComponent = component;

		// Also update the children when the selected component changes.
		this.childBindings = {};
		if (component) {
			for (const childPort of component.itemPorts) {
				// Make the new child reactive.
				Vue.set(this.childBindings, childPort.name, new ItemBinding(childPort, this, loadout));
			}
		}
	}

	_getComponentFromLoadout(loadout) {
		let container = loadout;
		let entry;

		for (const portName of this.portPath) {
			if (!container) {
				return undefined;
			}
			entry = container.find(n => n[portName] != undefined);
			container = _.get(entry, "attached");
		}

		return _.get(entry, this.portPath.slice(-1)[0]);
	}
}

class ShipCustomization {
	constructor(shipId) {
		this.shipId = shipId;

		this.childBindings = {};
		for (const shipPort of this._specification.getItemPorts(this.shipId.modificationId)) {
			this.childBindings[shipPort.name] = new ItemBinding(shipPort, undefined, this._loadout);
		}

		this.childGroups = ItemBindingGroup.findGroups(Object.values(this.childBindings));
	}

	// Serialization format: <shipId><bindingList>
	// <bindingList>: <count>{<typeDiscriminator><groupName or portName><componentName><bindingList of children>}
	// All string keys and values are hashed to 24 bits. All elements are individually base64 encoded.
	serialize() {
		let str = "1";
		str += this.shipId.serialize();

		const walk = (bindings, groups) => {
			const serializeBinding = (binding) => {
				const children = walk(binding.childBindings, binding.childGroups);
				return "B" + hashAndEncode(binding.port.name) + hashAndEncode(binding.selectedComponent.name) + children;
			};

			const serializeGroup = (group) => {
				const template = group.members[0];

				// Select the children for the template by preferring those that were customized. This ensures any child
				// set on a group is serialized, and doesn't rely on defaults which are inconsistent within the group.
				// TODO This probably isn't correct for third-level ports...
				let childBindings = {};
				for (const portName in template.childBindings) {
					const customized = group.members.map(m => m.childBindings[portName]).find(b => b.customized);
					childBindings[portName] = customized || template.childBindings[portName];
				}

				const children = walk(childBindings, template.childGroups);
				return "G" + hashAndEncode(group.name) + hashAndEncode(template.selectedComponent.name) + children;
			};

			let result = "";
			let count = 0;
			let remaining = Object.values(bindings).filter(b => b.customized);

			for (const group of groups.filter(g => g.members.length > 1)) {
				if (group.allIdentical && group.members.some(m => remaining.some(r => r.port.name == m.port.name))) {
					result += serializeGroup(group);
					count += 1;
					remaining = remaining.filter(r => !group.members.some(g => g.port.name == r.port.name));
				}
			}

			for (const binding of remaining) {
				result += serializeBinding(binding);
				count += 1;
			}

			return encodeSmallInt(count) + result;
		};

		str += walk(this.childBindings, this.childGroups);
		return str;
	}

	static deserialize(str) {
		const version = str.substr(0, 1);
		const shipId = str.substr(1, 12);
		let customization = new ShipCustomization(ShipId.deserialize(shipId));

		const findComponent = (hashedName) => {
			// TODO Also restrict this to matching components, to reduce hash collision chance.
			const componentName = Object.keys(mergedComponents).find(k => hashAndEncode(k) == hashedName);
			return mergedComponents[componentName];
		};

		const walk = (containers, index) => {
			const count = decodeSmallInt(str.substr(index, 1));
			index += 1;

			for (let current = 0; current < count; current += 1) {
				const discriminator = str.substr(index, 1);
				const name = str.substr(index + 1, 4);
				const value = str.substr(index + 5, 4);
				index += 9;

				let bindings = [];
				if (discriminator == "B") {
					const portName = Object.keys(containers[0].childBindings).find(k => hashAndEncode(k) == name);

					for (const container of containers) {
						const binding = container.childBindings[portName];
						bindings.push(binding);
					}
				}
				else if (discriminator == "G") {
					const groupName = containers[0].childGroups.map(g => g.name).find(n => hashAndEncode(n) == name);

					for (const container of containers) {
						const group = container.childGroups.find(g => g.name == groupName);
						for (const binding of group.members) {
							bindings.push(binding);
						}
					}
				}
				else {
					throw new Error("Invalid discriminator '" + discriminator + "'");
				}

				const component = findComponent(value);

				// Don't set component if it didn't change, because that would clear the child ports unnecessarily.
				// Set it if it's changing for other group members, though. Multi-select should stick and be consistent.
				if (!bindings.every(b => _.get(b.selectedComponent, "name") == _.get(component, "name"))) {
					bindings.forEach(b => b.selectedComponent = component);
				}

				index = walk(bindings, index);
			}

			return index;
		};

		walk([customization], 13);
		return customization;
	}

	get displayName() {
		return this._specification.getDisplayName(this.shipId.modificationId) || this.shipId.loadoutId;
	}

	// Abstracted because ship modifications will probably have their own tags eventually.
	get tags() {
		return this._specification.tags;
	}

	getAttributes(category=undefined) {
		let attributes = this._specification.getAttributes(this.shipId.modificationId);

		attributes = attributes.concat([
			{
				name: "Total Shields",
				category: "Survivability",
				value: Math.round(this._getAllAttachedComponents().reduce((total, x) => total + x.shieldCapacity, 0))
			},
			{
				name: "Total Burst DPS",
				category: "Damage",
				value: Math.round(this._getAllAttachedComponents().reduce((total, x) => total + x.gunBurstDps.total, 0))
			},
			{
				name: "Total Sustained DPS",
				category: "Damage",
				value: Math.round(this._getAllAttachedComponents().reduce((total, x) => total + x.gunSustainedDps.total, 0))
			},
			{
				name: "Total Missile Damage",
				category: "Damage",
				value: Math.round(this._getAllAttachedComponents().reduce((total, x) => total + x.missileDamage.total, 0))
			}
		]);

		if (category) {
			attributes = attributes.filter(n => n.category == category);
		}
		return attributes;
	}

	get _specification() {
		return shipSpecifications[this.shipId.specificationId];
	}

	get _loadout() {
		return shipLoadouts[this.shipId.loadoutId];
	}

	_getAllAttachedComponents() {
		const traverse = (binding) => {
			let result = [binding.selectedComponent];
			for (const child of Object.values(binding.childBindings)) {
				result = result.concat(traverse(child));
			}

			return result;
		};

		let result = [];
		for (const binding of Object.values(this.childBindings)) {
			result = result.concat(traverse(binding));
		}

		result = result.filter(n => n);
		return result;
	}
}


// Translate underlying data into model objects.
for (const key of Object.keys(shipSpecifications)) {
	shipSpecifications[key] = new ShipSpecification(shipSpecifications[key]);
}

var mergedComponents = {}
for (const key of Object.keys(dataforgeComponents)) {
	mergedComponents[key] = new DataforgeComponent(dataforgeComponents[key]);
}
for (const key of Object.keys(spaceshipComponents)) {
	if (!(key in mergedComponents)) {
		mergedComponents[key] = new SpaceshipComponent(spaceshipComponents[key]);
	}
}

var localizationItems = {};
var localizationVehicles = {};
for (const entry of localizationStrings) {
	if (entry["item_Name"]) {
		localizationItems[entry["item"]] = entry["item_Name"];
	}
	else if (entry["vehicle_Name"]) {
		localizationVehicles[entry["item"]] = entry["vehicle_Name"];
	}
}


// Represents a group on potentially multiple parents. If there are all multiple parents, they are assumed
// to be identical ports with identical components. If parents is undefined, the group is on the ship.
var itemPortGroup = Vue.component('item-port-group', {
	template: '#item-port-group',
	props: ['customization', 'groupName', 'parentBindings'],
	data: function() {
		const allGroups = this.getAllGroups();

		return {
			allGroups: allGroups,
			prototypeGroup: allGroups[0],
			linked: allGroups[0].allIdentical
		}
	},
	computed: {
		linkable: function() {
			return this.prototypeGroup.members.length > 1;
		},
		buttonText: function() {
			if (this.linked) {
				return "Unlink";
			}

			return "Link";
		}
	},
	methods: {
		getAllGroups: function() {
			if (this.parentBindings) {
				return this.parentBindings.map(b => b.childGroups.find(g => g.name == this.groupName));
			}
			else {
				return [this.customization.childGroups.find(g => g.name == this.groupName)];
			}
		},
		getBindingMap: function() {
			let arrays = [];
			for (const prototypeMember of this.prototypeGroup.members) {
				arrays.push({
					prototypeBinding: prototypeMember,
					targetBindings: this.allGroups.map(g => g.members.find(m => m.port.name == prototypeMember.port.name))});
			}

			if (this.linked) {
				arrays = [{
					prototypeBinding: this.prototypeGroup.members[0],
					targetBindings: arrays.reduce((total, a) => total.concat(a.targetBindings), [])}];
			}

			return arrays;
		},
		onClick: function() {
			this.linked = !this.linked;

			// When linking item ports, set their attached components to match the first in the group.
			if (this.linked) {
				const selectedComponent = this.allGroups[0].members[0].selectedComponent;
				const childBindings = this.allGroups[0].members[0].childBindings;

				for (const group of this.allGroups) {
					for (const other of group.members) {
						// Always set the component when linking a group. Multi-select should stick and be consistent.
						other.selectedComponent = selectedComponent;

						// TODO Currently ignoring third-level ports.
						if (other.portPath.length == 1) {
							for (const childName of Object.keys(childBindings)) {
								other.childBindings[childName].selectedComponent = childBindings[childName].selectedComponent;
							}
						}
					}
				}
			}
		}
	}
});

var componentDisplay = Vue.component('component-display', {
	template: '#component-display',
	props: ['componentName', 'disabled'],
	computed: {
		component: function () {
			return mergedComponents[this.componentName];
		}
	}
});

// itemPorts and parentItemPorts are arrays, so the selector can be bound to multiple item ports.
// If so, the selector assumes all the ports are all identical to the first!
var componentSelector = Vue.component('component-selector', {
	template: '#component-selector',
	props: ['customization', 'bindings'],
	data: function() {
		return {
			visible: false
		}
	},
	computed: {
		availableComponents: function () {
			return this.bindings[0].port.availableComponents(this.customization.tags);
		},
		label: function () {
			const port = this.bindings[0].port;
			let size = port.minSize;
			if (port.minSize != port.maxSize)
			{
				size += "-" + port.maxSize;
			}

			let name = port.name;
			if (this.bindings.length > 1) {
				name += " and similar";
			}

			return name + " (size " + size + ")";
		},
		selectedComponentName: function() {
			const component = this.bindings[0].selectedComponent;
			return _.get(component, "name");
		}
	},
	methods: {
		onVisibleChange: function(visible) {
			this.visible = visible;

			// Fix the width of the dropdown dynamically since the dropdown widget doesn't handle padding.
			const elementWidth = this.$refs["dropdown"].$el.offsetWidth;
			this.$refs["dropdown"].$refs["drop"].$el.style.width = elementWidth + "px";
		},
		onClick: function(name) {
			// Don't set component if it didn't change, because that would clear the child ports unnecessarily.
			// Set it if it's changing for other group members, though. Multi-select should stick and be consistent.
			if (!this.bindings.every(b => _.get(b.selectedComponent, "name") == name)) {
				for (const binding of this.bindings) {
					binding.selectedComponent = mergedComponents[name];
				}
			}
		}
	}
});

var shipList = Vue.component('ship-list', {
	template: '#ship-list',
	data: function() {
		return {
			tableHeight: this.getTableHeight(),
			attributeColumns: [
				{
					title: 'Action',
					fixed: "left",
					minWidth: 90,
					align: 'center',
					render: (h, params) => {
						return h('Button', {
							props: {
								type: "primary",
								size: "small"
							},
							on: {
								click: () => {
									this.customize(params.row.serialized)
								}
							}
						}, 'Customize');
					}
				},
				{
					title: "Vehicle",
					key: "displayName",
					sortable: true,
					fixed: "left",
					minWidth: 200,
					ellipsis: true
				},
				{
					title: "SCM",
					key: "Normal Speed",
					sortable: true,
					minWidth: 60
				},
				{
					title: "Afterburner",
					key: "Afterburner Speed",
					sortable: true,
					minWidth: 100
				},
				{
					title: "HP",
					key: "Total Hitpoints",
					sortable: true,
					minWidth: 60
				},
				{
					title: "Shields",
					key: "Total Shields",
					sortable: true,
					minWidth: 80
				},
				{
					title: "DPS",
					key: "Total Sustained DPS",
					sortable: true,
					minWidth: 60
				},
				{
					title: "Burst DPS",
					key: "Total Burst DPS",
					sortable: true,
					minWidth: 95
				},
				{
					title: "Missiles",
					key: "Total Missile Damage",
					sortable: true,
					minWidth: 80
				}
			]
		}
	},
	computed: {
		shipCustomizations: function() {
			return this.$root.shipIds.map(n => new ShipCustomization(n));
		},
		shipAttributes: function() {
			return this.shipCustomizations.map(c => {
				const attributes = c.getAttributes();
				let reduced = attributes.reduce((total, a) => {
					total[a.name] = a.value;
					return total;
				}, {});

				// Displayed as the row name.
				reduced.displayName = c.displayName;

				// Used for navigation to the customization page.
				reduced.serialized = c.serialize();
				return reduced;
			});
		}
	},
	methods: {
		customize(serialized) {
			this.$router.push({ name: 'customize', params: { serialized: serialized }});
		},
		getTableHeight() {
			// TODO This is a terribly sad hack, but it's good enough for now.
			return window.innerHeight - 144;
		},
		onResize(event) {
			this.tableHeight = this.getTableHeight();
		}
	},
	mounted() {
		window.addEventListener('resize', this.onResize);
	},
	beforeDestroy() {
		window.removeEventListener('resize', this.onResize);
	}
});

var shipDetails = Vue.component('ship-details', {
	template: '#ship-details',
	data: function() {
		return {
			selectedCustomization: {},

			// Also defines the section display order.
			sectionNames: ["Guns", "Missiles", "Systems"],
			expandedSections: ["Guns", "Missiles"],
			// Also defines the section precedence order; lowest precedence is first.
			sectionDefinitions: {
				"Guns": ['WeaponGun', 'Turret', 'TurretBase'],
				"Missiles": ['WeaponMissile'],
				"Systems": ['Cooler', 'Shield', 'PowerPlant']
			},

			damageColumns: [
				{
					title: "Damage",
					key: "name"
				},
				{
					title: " ",
					key: "value",
					width: 60
				}
			],
			maneuverabilityColumns: [
				{
					title: "Maneuverability",
					key: "name"
				},
				{
					title: " ",
					key: "value",
					width: 60
				}
			],
			survivabilityColumns: [
				{
					title: "Survivability",
					key: "name"
				},
				{
					title: " ",
					key: "value",
					width: 60
				}
			]
		}
	},
	watch: {
		selectedCustomization: {
			handler: function(val) {
				const serialized = val.serialize();
				let url = new URL(location.href);
				url.hash = "/customize/" + serialized;

				history.replaceState(history.state, document.title, url.href);
			},
			deep: true
		}
	},
	methods: {
		getSectionBindingGroups: function(sectionName) {
			const sectionIndex = Object.keys(this.sectionDefinitions).indexOf(sectionName);
			let excludedTypes = [];
			Object.keys(this.sectionDefinitions).forEach((x, index) => {
				if (index > sectionIndex) {
					excludedTypes = excludedTypes.concat(this.sectionDefinitions[x]);
				}
			});

			const sectionTypes = this.sectionDefinitions[sectionName];
			const candidates = this.selectedCustomization.childGroups;
			const sectionalized = candidates.filter(g => sectionTypes.some(t => g.members[0].port.matchesType(t, undefined)));

			const filtered = sectionalized.filter(g => !excludedTypes.some(e => g.members[0].port.matchesType(e, undefined)));
			return filtered;
		},
		getChildBindingGroups: function (prototypeBinding) {
			const childGroups = prototypeBinding.childGroups;

			// Hide AmmoBox item ports until they're worth customizing.
			return childGroups.filter(g => !g.members[0].port.matchesType("AmmoBox"));
		},
	},

	// TODO These hooks feel janky -- there should be a better way make the selection reactive.
	created() {
		this.selectedCustomization = ShipCustomization.deserialize(this.$route.params.serialized);
	},
	beforeRouteUpdate(to, from, next) {
		this.selectedCustomization = ShipCustomization.deserialize(to.params.serialized);
		next();
	}
});

Vue.use(VueRouter)
const router = new VueRouter({
	routes: [
		{
			name: "list",
			path: '/',
			component: shipList
		},
		{
			name: "customize",
			path: '/customize/:serialized',
			component: shipDetails
		},
		{
			path: "*",
			component: shipList
		}
	]
});

var app = new Vue({
	router,
	el: '#app',
	computed: {
		shipIds: function () {
			const unflattened = Object.values(shipSpecifications).map(n => n.getModificationLoadouts());
			const flattened = unflattened.reduce((total, n) => total.concat(n), []);

			const npcModifications = ["Pirate", "S42", "SQ42", "Dead", "CalMason", "Weak"];
			let filtered = flattened.filter(x => !x.modificationId || !npcModifications.some(n => x.modificationId.includes(n)));

			const npcSpecifications = ["Turret", "Old"];
			filtered = filtered.filter(x => !npcSpecifications.some(n => x.specificationId.includes(n)));

			return filtered;
		}
	}
}).$mount('#app');