/*!
 * Particleground
 * Adapted for RM365 loading screen
 * @author Jonathan Nicol - @mrjnicol
 * @version 1.1.0
 * @description Creates a canvas based particle system background
 */
(function(window, document) {
  'use strict';

  function extend(out) {
    out = out || {};
    for (var i = 1; i < arguments.length; i++) {
      var obj = arguments[i];
      if (obj) {
        for (var key in obj) {
          if (obj.hasOwnProperty(key)) {
            out[key] = obj[key];
          }
        }
      }
    }
    return out;
  }

  function particleground(element, options) {
    if (!element) return;

    var canvas, ctx, particles = [];
    var animationFrame;
    var windowWidth, windowHeight;
    var mouseX = 0, mouseY = 0;
    var orientX = 0, orientY = 0;
    var paused = false;

    var canvasSupport = !!document.createElement('canvas').getContext;
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    var orientationSupport = !!window.DeviceOrientationEvent;

    var settings = extend({}, particleground.defaults, options);

    function Particle() {
      this.active = true;
      this.layer = Math.ceil(Math.random() * 3);
      this.parallaxOffsetX = 0;
      this.parallaxOffsetY = 0;

      this.position = {
        x: Math.ceil(Math.random() * canvas.width),
        y: Math.ceil(Math.random() * canvas.height)
      };

      this.speed = {
        x: (Math.random() * (settings.maxSpeedX - settings.minSpeedX) + settings.minSpeedX) * (Math.random() > 0.5 ? 1 : -1),
        y: (Math.random() * (settings.maxSpeedY - settings.minSpeedY) + settings.minSpeedY) * (Math.random() > 0.5 ? 1 : -1)
      };
    }

    Particle.prototype.draw = function() {
      ctx.beginPath();
      ctx.arc(
        this.position.x + this.parallaxOffsetX,
        this.position.y + this.parallaxOffsetY,
        settings.particleRadius / 2,
        0,
        Math.PI * 2,
        true
      );
      ctx.closePath();
      ctx.fill();

      // Draw lines between close particles
      ctx.beginPath();
      for (var i = particles.length - 1; i > this.stackPos; i--) {
        var other = particles[i];
        var dx = this.position.x - other.position.x;
        var dy = this.position.y - other.position.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < settings.proximity) {
          ctx.moveTo(this.position.x + this.parallaxOffsetX, this.position.y + this.parallaxOffsetY);
          ctx.lineTo(other.position.x + other.parallaxOffsetX, other.position.y + other.parallaxOffsetY);
        }
      }
      ctx.stroke();
      ctx.closePath();
    };

    Particle.prototype.updatePosition = function() {
      if (settings.parallax) {
        var targetX, targetY;
        if (orientationSupport && isMobile) {
          // Mobile: use device orientation (tilt)
          targetX = orientX;
          targetY = orientY;
        } else {
          // Desktop: use mouse position
          targetX = mouseX;
          targetY = mouseY;
        }

        this.parallaxTargX = (targetX - windowWidth / 2) / (settings.parallaxMultiplier * this.layer);
        this.parallaxOffsetX += (this.parallaxTargX - this.parallaxOffsetX) / 10;
        this.parallaxTargY = (targetY - windowHeight / 2) / (settings.parallaxMultiplier * this.layer);
        this.parallaxOffsetY += (this.parallaxTargY - this.parallaxOffsetY) / 10;
      }

      var w = element.offsetWidth;
      var h = element.offsetHeight;

      // Bounce off edges
      if (this.position.x + this.speed.x > w || this.position.x + this.speed.x < 0) {
        this.speed.x = -this.speed.x;
      }
      if (this.position.y + this.speed.y > h || this.position.y + this.speed.y < 0) {
        this.speed.y = -this.speed.y;
      }

      this.position.x += this.speed.x;
      this.position.y += this.speed.y;
    };

    Particle.prototype.setStackPos = function(pos) {
      this.stackPos = pos;
    };

    function init() {
      if (!canvasSupport) return;

      canvas = document.createElement('canvas');
      canvas.className = 'pg-canvas';
      canvas.style.display = 'block';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      element.insertBefore(canvas, element.firstChild);
      ctx = canvas.getContext('2d');

      styleCanvas();

      var particleCount = Math.round((canvas.width * canvas.height) / settings.density);
      for (var i = 0; i < particleCount; i++) {
        var p = new Particle();
        p.setStackPos(i);
        particles.push(p);
      }

      window.addEventListener('resize', onResize, false);
      document.addEventListener('mousemove', onMouseMove, false);

      if (orientationSupport) {
        window.addEventListener('deviceorientation', onOrientation, true);
      }

      draw();
    }

    function styleCanvas() {
      var dpr = window.devicePixelRatio || 1;
      var width = element.offsetWidth;
      var height = element.offsetHeight;
      
      // Set the canvas internal size (accounting for DPR)
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      
      // Scale the context to match DPR
      ctx.scale(dpr, dpr);
      
      // Set the canvas CSS size (actual display size)
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      
      ctx.fillStyle = settings.dotColor;
      ctx.strokeStyle = settings.lineColor;
      ctx.lineWidth = settings.lineWidth;
    }

    function draw() {
      if (!canvasSupport) return;

      windowWidth = window.innerWidth;
      windowHeight = window.innerHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var i = 0; i < particles.length; i++) {
        particles[i].updatePosition();
      }
      for (var j = 0; j < particles.length; j++) {
        particles[j].draw();
      }

      if (!paused) {
        animationFrame = requestAnimationFrame(draw);
      }
    }

    function onResize() {
      styleCanvas();
      var particleCount = Math.round((canvas.width * canvas.height) / settings.density);
      
      // Remove excess particles
      if (particleCount < particles.length) {
        particles.splice(particleCount);
      }
      // Add more particles if needed
      while (particleCount > particles.length) {
        var p = new Particle();
        p.setStackPos(particles.length);
        particles.push(p);
      }
      
      // Update stack positions
      for (var i = 0; i < particles.length; i++) {
        particles[i].setStackPos(i);
      }
    }

    function onMouseMove(e) {
      mouseX = e.pageX;
      mouseY = e.pageY;
    }

    function onOrientation(e) {
      orientX = Math.min(Math.max(-e.gamma, -30), 30);
      orientY = Math.min(Math.max(-e.beta, -30), 30);
    }

    function pause() {
      paused = true;
    }

    function start() {
      paused = false;
      draw();
    }

    function destroy() {
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('deviceorientation', onOrientation);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    }

    init();

    return {
      pause: pause,
      start: start,
      destroy: destroy
    };
  }

  particleground.defaults = {
    minSpeedX: 0.1,
    maxSpeedX: 0.7,
    minSpeedY: 0.1,
    maxSpeedY: 0.7,
    density: 10000,
    dotColor: '#666666',
    lineColor: '#666666',
    particleRadius: 7,
    lineWidth: 1,
    proximity: 100,
    parallax: true,
    parallaxMultiplier: 5
  };

  window.particleground = particleground;

})(window, document);
