const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

themedPage({
  data: { pets: [], petId: "", petText: "", photos: [], error: "", loading: true, manage: false, picked: [], removeCount: 0 },
  onShow() { this.load(); },
  load() {
    api.request("/api/pets").then((pets) => {
      const petId = this.data.petId || (pets.find((item) => item.isDefault) || pets[0] || {}).id || "";
      const current = pets.find((item) => item.id === petId);
      this.setData({ pets, petId, petText: current ? current.name : "" });
      return petId ? api.request("/api/photos?petId=" + petId) : [];
    })
      .then((photos) => this.setData({ photos: photos || [], loading: false }))
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },
  choosePet(event) {
    const pet = this.data.pets[Number(event.detail.value)];
    if (!pet) return;
    this.setData({ petId: pet.id, petText: pet.name, picked: [], manage: false, loading: true });
    api.request("/api/photos?petId=" + pet.id)
      .then((photos) => this.setData({ photos, loading: false }))
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },
  toggleManage() { this.setData({ manage: !this.data.manage, picked: [] }); },
  /** 管理模式下点格子 = 勾选/取消勾选，用于批量删除 */
  togglePick(event) {
    const id = event.detail.id;
    const picked = this.data.picked.slice();
    const index = picked.indexOf(id);
    if (index >= 0) picked.splice(index, 1); else picked.push(id);
    this.setData({ picked });
  },
  askRemove() { if (this.data.picked.length) this.setData({ removeCount: this.data.picked.length }); },
  cancelRemove() { this.setData({ removeCount: 0 }); },
  confirmRemove() {
    const ids = this.data.picked.slice();
    this.setData({ removeCount: 0 });
    Promise.all(ids.map((id) => api.request("/api/photos/" + id, { method: "DELETE" })))
      .then(() => { this.setData({ picked: [], manage: false }); wx.showToast({ title: "已删除", icon: "none" }); this.load(); })
      .catch((error) => this.setData({ error: error.message }));
  },
  goCreate() { wx.switchTab({ url: "/pages/index/index" }); }
});
