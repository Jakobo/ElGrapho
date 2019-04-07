const UUID = require('./UUID');
const WebGL = require('./WebGL');
const Profiler = require('./Profiler');
const ElGraphoCollection = require('./ElGraphoCollection');
const Controls = require('./components/Controls/Controls');
const Count = require('./components/Count/Count');
const Events = require('./Events');
const Concrete = require('concretejs');
const _ = require('lodash');
const Color = require('./Color');
const Theme = require('./Theme');
const Tooltip = require('./components/Tooltip/Tooltip');
const NumberFormatter = require('./formatters/NumberFormatter');
const VertexBridge = require('./VertexBridge');
const Enums = require('./Enums');
const BoxZoom = require('./components/BoxZoom/BoxZoom');
const Dom = require('./Dom');
const Loading = require('./components/Loading/Loading');
const Labels = require('./Labels');

const Tree = require('./layouts/Tree');
const Cluster = require('./layouts/Cluster');
const Chord = require('./layouts/Chord');
const ForceDirected = require('./layouts/ForceDirected');
const Hairball = require('./layouts/Hairball');
const RadialTree = require('./layouts/RadialTree');

const ZOOM_FACTOR = 2;
const START_SCALE = 1;
const MAX_NODE_SIZE = 16;

let ElGrapho = function(config) {
  let that = this;

  // if promise
  if (config.model.then !== undefined) {
    config.model.then(function(model) {
      config.model = model;
      that.init(config);
    }); 
  }
  // if regular old object
  else {
    this.init(config);
  }
};

ElGrapho.prototype = {
  init: function(config) {
    this.container = config.container || document.createElement('div');
    this.id = UUID.generate();
    this.dirty = true;
    this.hitDirty = true;
    this.zoomX = START_SCALE;
    this.zoomY = START_SCALE;
    this.panX = 0;
    this.panY = 0;
    this.events = new Events();
    this.model = config.model;
    this.width = config.model.width;
    this.height = config.model.height;
    this.steps = config.model.steps;
    this.nodeSize = config.nodeSize || 1;
    this.nodeSize *= MAX_NODE_SIZE;
    
    this.animations = [];
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'el-grapho-wrapper';
    this.wrapper.style.width = this.width + 'px';
    this.wrapper.style.height = this.height + 'px';
    // clear container
    this.container.innerHTML = '';
    this.container.appendChild(this.wrapper);
    this.animations = config.animations === undefined ? true : config.animations;
    this.setInteractionMode(Enums.interactionMode.SELECT);
    this.panStart = null;
    this.idle = true;
    this.debug = config.debug === undefined ? false : config.debug;
    
    this.showArrows = config.arrows === undefined ? false : config.arrows;

    // default tooltip template
    this.tooltipTemplate = function(index, el) {
      el.innerHTML = ElGrapho.NumberFormatter.addCommas(index);
    };
    this.hoveredDataIndex = -1;

    // all Listeners we need to call remove for on cleanup
    this.allListeners = [];

    let viewport = this.viewport = new Concrete.Viewport({
      container: this.wrapper,
      width: this.width,
      height: this.height
    });

    let mainLayer = new Concrete.Layer({
      contextType: 'webgl'
    });

    let labelsLayer = this.labelsLayer = new Concrete.Layer({
      contextType: '2d'
    });

    viewport.add(mainLayer);
    viewport.add(labelsLayer);


    this.webgl = new WebGL({
      layer: mainLayer
    });

    //webgl.initShaders();

    if (!ElGraphoCollection.initialized) {
      ElGraphoCollection.init();
    }



    // mainLayer.hit.canvas.style.display = 'inline-block';
    // mainLayer.hit.canvas.style.marginLeft = '10px';
    // this.wrapper.appendChild(mainLayer.hit.canvas);

    //this.model = config.model;

    //this.model = config.model;

    let vertices = this.vertices = VertexBridge.modelToVertices(config.model, this.width, this.height, this.showArrows);

    // need to add focused array to the vertices object here because we need to be able to
    // modify the focused array by reference, which is passed into webgl buffers
    let numPoints = vertices.points.positions.length/2;
    vertices.points.focused = new Float32Array(numPoints);

    this.webgl.initBuffers(vertices);
    

    this.initComponents();

    this.labels = new Labels();

    this.listen();

    ElGraphoCollection.graphs.push(this);
  },
  initComponents: function() {
    let model = this.model;

    this.controls = new Controls({
      container: this.wrapper,
      graph: this,
      showStepControls: true
    });

    this.loading = new Loading({
      container: this.wrapper
    });

    if (this.debug) {
      this.count = new Count({
        container: this.wrapper
      });

      this.count.update(model.nodes.length, model.edges.length, model.steps);
    }
  },
  renderLabels: function() {
    let that = this;

    // build labels view model
    this.labels.clear();
    let positions = this.vertices.points.positions;
    this.model.nodes.forEach(function(node, n) {
      let index = n * 2;
      that.labels.addLabel(node.label, positions[index], positions[index+1]);
    });
    
    // render
    let labelsScene = this.labelsLayer.scene;
    let labelsContext = labelsScene.context;

    labelsContext.save();
    
    labelsContext.translate(this.width/2, this.height/2);
    //labelsContext.scale(this.zoomX, this.zoomY);
    labelsContext.textAlign = 'center'; 
    

    labelsContext.font = '12px Arial';
    labelsContext.fillStyle = '#333';
    labelsContext.strokeStyle = 'white';
    labelsContext.lineWidth = 3;
    labelsContext.lineJoin = 'round';

    this.labels.labelsAdded.forEach(function(label) {
      let x = label.x * that.zoomX + that.panX;
      let y = label.y * -1 * that.zoomY - that.panY - 10;
      labelsContext.beginPath();
      labelsContext.strokeText(label.str, x, y);
      labelsContext.fillText(label.str, x, y);
    });


    labelsContext.restore();
  },
  getMousePosition(evt) {
    let boundingRect = this.wrapper.getBoundingClientRect();
    let x = evt.clientX - boundingRect.left;
    let y = evt.clientY - boundingRect.top;

    return {
      x: x,
      y: y
    };
  },
  addListener: function(o, on, fn) {
    this.allListeners[on] = this.allListeners[on] || [];
    this.allListeners[on].push({
      o: o,
      on: on,
      fn: fn
    });
    o.addEventListener(on, fn);
  },
  removeAllListeners: function() {
    const len = this.allListeners.length;
    for (let n=0; n<len; n++) {
      let l = this.allListeners[n];
      l.o.removeEventListener(l.on, l.fn);
    }
    this.allListeners = [];
  },
  listen: function() {
    let that = this;
    let viewport = this.viewport;

    this.on('zoom-in', function() {
      that.zoomIn();
    });

    this.on('zoom-out', function() {
      that.zoomOut();
    });

    this.on('reset', function() {
      that.reset();
    });

    this.on('select', function() {
      that.setInteractionMode(Enums.interactionMode.SELECT);
    });

    this.on('pan', function() {
      that.setInteractionMode(Enums.interactionMode.PAN);
    });

    this.on('box-zoom', function() {
      that.setInteractionMode(Enums.interactionMode.BOX_ZOOM);
    });

    this.on('step-up', function() {
      that.stepUp();
    });

    this.on('step-down', function() {
      that.stepDown();
    });

    this.addListener(document, 'mousedown', function(evt) {
      if (Dom.closest(evt.target, '.el-grapho-controls')) {
        return;
      }
      if (that.interactionMode === Enums.interactionMode.BOX_ZOOM) {
        let mousePos = that.getMousePosition(evt);
        that.zoomBoxAnchor = {
          x: mousePos.x,
          y: mousePos.y
        };

        BoxZoom.create(evt.clientX, evt.clientY);
      }
    });

    this.addListener(viewport.container, 'mousedown', function(evt) {
      
      
      if (Dom.closest(evt.target, '.el-grapho-controls')) {
        return;
      }
      if (that.interactionMode === Enums.interactionMode.PAN) {
        let mousePos = that.getMousePosition(evt);
        that.panStart = mousePos;
        Tooltip.hide();
        

      }
    });

    this.addListener(document, 'mousemove', function(evt) {
      if (that.interactionMode === Enums.interactionMode.BOX_ZOOM) {
        BoxZoom.update(evt.clientX, evt.clientY);
      }
    });
    
    this.addListener(viewport.container, 'mousemove', _.throttle(function(evt) {
      let mousePos = that.getMousePosition(evt);
      let dataIndex = viewport.getIntersection(mousePos.x, mousePos.y);

      if (that.interactionMode === Enums.interactionMode.PAN) {
        if (that.panStart) {
          let mouseDiff = {
            x: mousePos.x - that.panStart.x,
            y: mousePos.y - that.panStart.y
          };

          viewport.scene.canvas.style.marginLeft = mouseDiff.x + 'px';
          viewport.scene.canvas.style.marginTop = mouseDiff.y + 'px';

          
        }
      }

      // if panning or zoom boxing hide tooltip
      if (that.panStart || that.zoomBoxAnchor) {
        Tooltip.hide();
      }

      // don't show tooltips if actively panning or zoom boxing
      if (!that.panStart && !that.zoomBoxAnchor) {
        if (dataIndex === -1) {
          Tooltip.hide();
        }
        else {
          Tooltip.render(dataIndex, evt.clientX, evt.clientY, that.tooltipTemplate);
        }

        // change point state
        if (dataIndex !== that.hoveredDataIndex) {
          if (that.hoveredDataIndex > -1) {
            that.vertices.points.focused[that.hoveredDataIndex] = 0;
          }

          that.vertices.points.focused[dataIndex] = 1;
          that.webgl.initBuffers(that.vertices);
          that.dirty = true;

          if (that.hoveredDataIndex !== -1) {
            that.fire(Enums.events.NODE_MOUSEOUT, {
              dataIndex: that.hoveredDataIndex
            });  
          }
          
          that.hoveredDataIndex = dataIndex; 

          if (that.hoveredDataIndex !== -1) {
            that.fire(Enums.events.NODE_MOUSEOVER, {
              dataIndex: that.hoveredDataIndex
            });  
          }       
        }
      }      
    }, 17));


    this.addListener(document, 'mouseup', function(evt) {
      if (Dom.closest(evt.target, '.el-grapho-controls')) {
        return;
      }
      if (that.interactionMode === Enums.interactionMode.BOX_ZOOM) {
        if (!that.zoomBoxAnchor) {
          return;
        }

        let mousePos = that.getMousePosition(evt);
        let topLeftX, topLeftY;
        let width, height;
        let zoomX, zoomY;

        // direction: right down
        if (mousePos.x > that.zoomBoxAnchor.x && mousePos.y > that.zoomBoxAnchor.y) {
          width = mousePos.x - that.zoomBoxAnchor.x;
          height = mousePos.y - that.zoomBoxAnchor.y;
          topLeftX = that.zoomBoxAnchor.x;
          topLeftY = that.zoomBoxAnchor.y;
        }
        // direction: right up
        else if (mousePos.x > that.zoomBoxAnchor.x && mousePos.y <= that.zoomBoxAnchor.y) {
          width = mousePos.x - that.zoomBoxAnchor.x;
          height = that.zoomBoxAnchor.y - mousePos.y;
          topLeftX = that.zoomBoxAnchor.x;
          topLeftY = mousePos.y;
        }
        // direction: left up
        else if (mousePos.x <= that.zoomBoxAnchor.x && mousePos.y <= that.zoomBoxAnchor.y) {
          width = that.zoomBoxAnchor.x - mousePos.x;
          height =  that.zoomBoxAnchor.y - mousePos.y; 
          topLeftX = mousePos.x;
          topLeftY = mousePos.y; 
        }
        // direction: left down
        else if (mousePos.x <= that.zoomBoxAnchor.x && mousePos.y > that.zoomBoxAnchor.y) {
          width = that.zoomBoxAnchor.x - mousePos.x;
          height =  mousePos.y - that.zoomBoxAnchor.y; 
          topLeftX = mousePos.x;
          topLeftY = that.zoomBoxAnchor.y;   
        }

        let viewportWidth = viewport.width;
        let viewportHeight = viewport.height;

        // if just clicking on a point...
        if (width < 2 || height < 2) {
          zoomX = ZOOM_FACTOR;
          zoomY = ZOOM_FACTOR;
          width = 0;
          height = 0;
          topLeftX = mousePos.x;
          topLeftY = mousePos.y;
        }
        else {
          zoomX = viewportWidth / width;
          zoomY = viewportHeight / height;
        }


        let viewportCenterX = viewportWidth/2;
        let viewportCenterY = viewportHeight/2;

        let boxCenterX = (topLeftX + width/2);
        let panX = (viewportCenterX - boxCenterX) * that.zoomX;
        let boxCenterY = (topLeftY + height/2);
        let panY = (boxCenterY - viewportCenterY) * that.zoomY;

        that.zoomToPoint(panX, panY, zoomX, zoomY);
        BoxZoom.destroy();
        that.zoomBoxAnchor = null;
      }
    });
    this.addListener(viewport.container, 'mouseup', function(evt) {
      if (Dom.closest(evt.target, '.el-grapho-controls')) {
        return;
      }

      if (!that.panStart && !that.zoomBoxAnchor) {
        let mousePos = that.getMousePosition(evt);
        let dataIndex = viewport.getIntersection(mousePos.x, mousePos.y);

        if (dataIndex !== -1) {
          that.fire(Enums.events.NODE_CLICK, {
            dataIndex: dataIndex
          });  
        } 
      }

      if (that.interactionMode === Enums.interactionMode.PAN) {
        let mousePos = that.getMousePosition(evt);

        let mouseDiff = {
          x: mousePos.x - that.panStart.x,
          y: mousePos.y - that.panStart.y
        };

        // that.panX += mouseDiff.x / that.scale;
        // that.panY -= mouseDiff.y / that.scale;
        that.panX += mouseDiff.x;
        that.panY -= mouseDiff.y;

        that.panStart = null;

        viewport.scene.canvas.style.marginLeft = 0;
        viewport.scene.canvas.style.marginTop = 0;

        that.dirty = true;
        that.hitDirty = true;
      }
    });

    this.addListener(viewport.container, 'mouseout', _.throttle(function() {
      Tooltip.hide();
    }));
  },
  // stepUp: function() {
  //   console.log('step up');

  //   this.model.step++;
  //   //this.updateVertices();
  // },
  // stepDown: function() {
  //   console.log('step down');
  // },
  setInteractionMode: function(mode) {
    this.interactionMode = mode;
    this.wrapper.className = 'el-grapho-wrapper el-grapho-' + mode + '-interaction-mode';
  },
  zoomToPoint: function(panX, panY, zoomX, zoomY) {
    Tooltip.hide();
    if (this.animations) {
      this.animations = [];

      let that = this;
      this.animations.push({
        startVal: that.zoomX,
        endVal: that.zoomX * zoomX,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'zoomX'
      });
      this.animations.push({
        startVal: that.zoomY,
        endVal: that.zoomY * zoomY,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'zoomY'
      });
      this.animations.push({
        startVal: that.panX,
        endVal: (that.panX + panX / that.zoomX) * zoomX,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'panX'
      });
      this.animations.push({
        startVal: that.panY,
        endVal: (that.panY + panY / that.zoomY) * zoomY,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'panY'
      });
      this.dirty = true;
    }
    else {
      this.panX = (this.panX + panX / this.zoomX) * zoomX;
      this.panY = (this.panY + panY / this.zoomY) * zoomY;
      this.zoomX = this.zoomX * zoomX;
      this.zoomY = this.zoomY * zoomY;
      this.dirty = true;
      this.hitDirty = true;
    }
  },
  zoomIn: function() {
    Tooltip.hide();
    this.zoomToPoint(0, 0, ZOOM_FACTOR, ZOOM_FACTOR);
  },
  zoomOut: function() {
    Tooltip.hide();
    this.zoomToPoint(0, 0, 1/ZOOM_FACTOR, 1/ZOOM_FACTOR);
  },
  reset: function() {
    Tooltip.hide();
    if (this.animations) {
      this.animations = [];

      let that = this;
      this.animations.push({
        startVal: that.zoomX,
        endVal: START_SCALE,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'zoomX'
      });
      this.animations.push({
        startVal: that.zoomY,
        endVal: START_SCALE,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'zoomY'
      });

      this.animations.push({
        startVal: that.panX,
        endVal: 0,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'panX'
      });

      this.animations.push({
        startVal: that.panY,
        endVal: 0,
        startTime: new Date().getTime(),
        endTime: new Date().getTime() + 300,
        prop: 'panY'
      });

      this.dirty = true;
    }
    else {
      this.zoomX = START_SCALE;
      this.zoomY = START_SCALE;
      this.panX = 0;
      this.panY = 0;
      this.dirty = true;
      this.hitDirty = true;
    }
  },
  on: function(name, func) {
    this.events.on(name, func);
  },
  fire: function(name, evt) {
    this.events.fire(name, evt);
  },
  showLoading: function() {
    this.wrapper.classList.add('el-grapho-loading');
  },
  hideLoading: function() {
    this.wrapper.classList.remove('el-grapho-loading');
  },
  destroy: function() {
    // listeners
    this.removeAllListeners();
    
    // viewport
    this.viewport.destroy();

    // remove from collection
    ElGraphoCollection.remove(this);
  }
};

// export modules
ElGrapho.Theme = Theme;
ElGrapho.Color = Color;
ElGrapho.Profiler = Profiler;
ElGrapho.NumberFormatter = NumberFormatter;
ElGrapho.layouts = {
  Tree: Tree,
  Cluster: Cluster,
  Chord: Chord,
  ForceDirected: ForceDirected,
  Hairball: Hairball,
  RadialTree: RadialTree
};

module.exports = ElGrapho;
