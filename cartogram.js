(function(exports) {

  /*
   * d3.cartogram is a d3-friendly implementation of An Algorithm to Construct
   * Continuous Area Cartograms:
   *
   * <http://chrisman.scg.ulaval.ca/G360/dougenik.pdf>
   *
   * It requires topojson to decode TopoJSON-encoded topologies:
   *
   * <http://github.com/mbostock/topojson/>
   *
   * Usage:
   *
   * var cartogram = d3.cartogram()
   *  .projection(d3.geo.albersUsa())
   *  .value(function(d) {
   *    return Math.random() * 100;
   *  });
   * d3.json("path/to/topology.json", function(topology) {
   *  var features = cartogram(topology);
   *  d3.select("svg").selectAll("path")
   *    .data(features)
   *    .enter()
   *    .append("path")
   *      .attr("d", cartogram.path);
   * });
   */
var cosArctan = function(dx,dy){
       var div = dx/dy;
       if(dy>0){
           return 1/Math.sqrt(1+(div*div));
       }else{
           return (-1/Math.sqrt(1+(div*div)));
       }
       
   };
var sinArctan = function(dx,dy){
       var div = dx/dy;
       if(dy>0){
       return div/Math.sqrt(1+(div*div));
       }else{
           return (-div/Math.sqrt(1+(div*div)));
       }
   }
  d3.cartogram = function() {

    function carto(topology, geometries, cb) {
      // copy it first
      topology = copy(topology);

      // objects are projected into screen coordinates


      // project the arcs into screen space
      var tf = transformer(topology.transform),
          projectedArcs = topology.arcs.map(function(arc) {
            var x = 0, y = 0;
            return arc.map(function(coord) {
              coord[0] = (x += coord[0]);
              coord[1] = (y += coord[1]);
              return tf(coord);
            });
          });

      // path with identity projection
      var path = d3.geo.path()
        .projection(null);

      var objects = object(projectedArcs, {type: "GeometryCollection", geometries: geometries})
          .geometries.map(function(geom) {
            return {
              type: "Feature",
              id: geom.properties.id,
              properties: geom.properties,
              geometry: geom
            };
          });

      var values = objects.map(value),
          totalValue = values.reduce(function(a,b){return a + b;});
      // no iterations; just return the features
      if (iterations <= 0) {
        return cb(objects);
      }

      var i = 0;
      while (i++ < iterations) {
        var areas = objects.map(path.area);
            var totalArea = sum(areas),
            sizeErrorsTot =0,
            sizeErrorsNum=0,
            meta = objects.map(function(o, j) {
              var area = Math.abs(areas[j]), // XXX: why do we have negative areas?
                  v = +values[j],
                  desired = totalArea * v / totalValue,
                  radius = Math.sqrt(area / Math.PI),
                  mass = Math.sqrt(desired / Math.PI) - radius,
                  sizeError = Math.max(area, desired) / Math.min(area, desired);
              sizeErrorsTot+=sizeError;
              sizeErrorsNum++
              // console.log(o.id, "@", j, "area:", area, "value:", v, "->", desired, radius, mass, sizeError);
              return {
                id:         o.id,
                area:       area,
                centroid:   path.centroid(o),
                value:      v,
                desired:    desired,
                radius:     radius,
                mass:       mass,
                sizeError:  sizeError
              };
            });

        var sizeError = sizeErrorsTot/sizeErrorsNum,
            forceReductionFactor = 1 / (1 + sizeError);

        // console.log("meta:", meta);
        // console.log("  total area:", totalArea);
        // console.log("  force reduction factor:", forceReductionFactor, "mean error:", sizeError);
        var len1,i1,delta,len2=projectedArcs.length,i2=0;
        while(i2<len2){
            len1=projectedArcs[i2].length;
            i1=0;
          while(i1<len1){
            // create an array of vectors: [x, y]
            delta = meta.reduce(function(a,d) {
              var centroid =  d.centroid,
                  mass =      d.mass,
                  radius =    d.radius,
                  rSquared = (radius*radius),
                  dx = projectedArcs[i2][i1][0] - centroid[0],
                    dy = projectedArcs[i2][i1][1] - centroid[1],
                  distSquared = dx * dx + dy * dy,
                  dist=Math.sqrt(distSquared),
                  Fij = (dist > radius)
                    ? mass * radius / dist
                    : mass *
                      (distSquared / rSquared) *
                      (4 - 3 * dist / radius);
              return [
                a[0]+(Fij * cosArctan(dy,dx)),
                a[1]+(Fij * sinArctan(dy,dx))
              ];
            },[0,0]);

            // using Fij and angles, calculate vector sum
            

            projectedArcs[i2][i1][0] += (delta[0]*forceReductionFactor)
            projectedArcs[i2][i1][1] += (delta[1]*forceReductionFactor);
          i1++;
          };
          i2++;
        };

        // break if we hit the target size error
        if (sizeError <= 0.20) break;
      }

      cb(objects);
    }

    var iterations = 8,
        properties = function(id) {
          return {};
        },
        value = function(d) {
          return 1;
        };

    // for convenience
    carto.path = d3.geo.path()
      .projection(null);

    carto.iterations = function(i) {
      if (arguments.length) {
        iterations = i;
        return carto;
      } else {
        return iterations;
      }
    };

    carto.value = function(v) {
      if (arguments.length) {
        value = d3.functor(v);
        return carto;
      } else {
        return value;
      }
    };


    carto.feature = function(topology, geom) {
      return {
        type: "Feature",
        id: geom.id,
        properties: properties.call(null, geom, topology),
        geometry: {
          type: geom.type,
          coordinates: topojson.object(topology, geom).coordinates
        }
      };
    };

    carto.features = function(topo, geometries) {
      return geometries.map(function(f) {
        return carto.feature(topo, f);
      });
    };

    carto.properties = function(props) {
      if (arguments.length) {
        properties = d3.functor(props);
        return carto;
      } else {
        return properties;
      }
    };

    return carto;
  };

  var transformer = d3.cartogram.transformer = function(tf) {
    var kx = tf.scale[0],
        ky = tf.scale[1],
        dx = tf.translate[0],
        dy = tf.translate[1];

    function transform(c) {
      return [c[0] * kx + dx, c[1] * ky + dy];
    }

    transform.invert = function(c) {
      return [(c[0] - dx) / kx, (c[1]- dy) / ky];
    };

    return transform;
  };

  function angle(a, b) {
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  function distance(centroid, coord) {
    var dx = coord[0] - centroid[0],
        dy = coord[1] - centroid[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function projector(proj) {
    var types = {
      Point: proj,
      LineString: function(coords) {
        return coords.map(proj);
      },
      MultiLineString: function(arcs) {
        return arcs.map(types.LineString);
      },
      Polygon: function(rings) {
        return rings.map(types.LineString);
      },
      MultiPolygon: function(rings) {
        return rings.map(types.Polygon);
      }
    };
    return function(geom) {
      return types[geom.type](geom.coordinates);
    };
  }

  function copy(o) {
    return (o instanceof Array)
      ? o.map(copy)
      : (typeof o === "string" || typeof o === "number")
        ? o
        : copyObject(o);
  }
  
  function copyObject(o) {
    var obj = {};
    for (var k in o) obj[k] = copy(o[k]);
    return obj;
  }
function sum(numbers) {
    var total = 0;
    for (var i = numbers.length - 1; i-- > 0;) {
      total += numbers[i];
    }
    return total;
  } function mean(numbers) {
    return sum(numbers) / numbers.length;
  }

  function object(arcs, o) {
    function arc(i, points) {
      if (points.length) points.pop();
      for (var a = arcs[i < 0 ? ~i : i], k = 0, n = a.length; k < n; ++k) {
        points.push(a[k]);
      }
      if (i < 0) reverse(points, n);
    }

    function line(arcs) {
      var points = [];
      for (var i = 0, n = arcs.length; i < n; ++i) arc(arcs[i], points);
      return points;
    }

    function polygon(arcs) {
      return arcs.map(line);
    }

    function geometry(o) {
      o = Object.create(o);
      o.coordinates = geometryType[o.type](o.arcs);
      return o;
    }

    var geometryType = {
      LineString: line,
      MultiLineString: polygon,
      Polygon: polygon,
      MultiPolygon: function(arcs) { return arcs.map(polygon); }
    };

    return o.type === "GeometryCollection"
        ? (o = Object.create(o), o.geometries = o.geometries.map(geometry), o)
        : geometry(o);
  }

  function reverse(array, n) {
    var t, j = array.length, i = j - n; while (i < --j) t = array[i], array[i++] = array[j], array[j] = t;
  }

})(this);
